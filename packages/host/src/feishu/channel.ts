/**
 * 飞书渠道适配器（M2′ 渠道项）— 把飞书会话接到「同一个它」的产品记录上。
 *
 * 设计依据（顶层设计 §5、存档 §5 IM behavior）：
 *   - IM 是远程监视+审批器：读写与 CLI 同一套 Conversation/Task/Run/
 *     Approval 记录，不是独立 chatbot 会话；
 *   - 身份白名单：open_id → Penglai 身份，默认拒绝一切未白名单用户；
 *   - 会话路由持久化：chat_id → Conversation/默认项目（product-store，
 *     重启水合不丢）；任务→会话路由决定进度播报与审批卡片的落点；
 *   - 任务化操作：开工（= mode.proposeWork）、任务列表、暂停/继续/取消、
 *     批准/拒绝、完成/退出；
 *   - 有界进度播报：状态变化即时 + 回合进度按时间节流；
 *   - 长输出纪律：聊天内只放摘要，全文本就在 transcript / Evidence
 *     （产品记录是唯一事实源），截断时指明全文落点；
 *   - 幂等：event_id 去重（INSERT OR IGNORE 原子），重投不重复处理；
 *   - 所有 handler 不向外抛错：错误在会话内告知，事件一律 ack
 *     （nack 会触发飞书重投，而已去重的事件会被跳过 → 消息丢失）。
 *
 * 待真机联调验证：群聊@、富文本/语音消息、卡片回调细节（见 protocol.ts）。
 */

import * as crypto from "node:crypto";
import type {
  Approval,
  Conversation,
  ModelProfile,
  Project,
  Run,
  Task,
  Workspace,
} from "@penglai/protocol";
import type { ApprovalService } from "../approvals.js";
import type {
  ConversationExecutor,
  ConversationPromptResult,
} from "../conversation-executor.js";
import type {
  ConfirmWorkInput,
  ConfirmWorkResult,
  ExitWorkInput,
  ExitWorkResult,
  ModeSwitchContext,
} from "../mode-switch.js";
import { confirmWork, exitWork, getMode, proposeWork } from "../mode-switch.js";
import type { ProductStore } from "../storage/product-store.js";
import type { TaskRunner } from "../task-runner.js";
import type { FeishuApiClient } from "./api-client.js";
import {
  EVENT_CARD_ACTION,
  EVENT_MESSAGE_RECEIVE,
  buildApprovalCard,
  buildApprovalDecidedCard,
  buildTrustCard,
  extractCardAction,
  extractReceivedMessage,
  type FeishuEventEnvelope,
  type FeishuReceivedMessage,
} from "./protocol.js";

// ── 可调常量（待 owner 校准） ────────────────────────────────────

/** 进度播报节流：同一任务回合进度两次播报的最小间隔。 */
export const PROGRESS_THROTTLE_MS = 180_000;
/** 单条飞书文本消息的最大字符数（超出截断并指明全文落点）。 */
export const MAX_MESSAGE_CHARS = 4000;
/** 任务/审批列表在 IM 里的最大行数。 */
const MAX_LIST_ROWS = 8;
/** 完成摘要里引用的模型回复摘录长度。 */
const SUMMARY_EXCERPT_CHARS = 600;

const CHANNEL = "feishu";

/** 面向用户的错误（在会话内回复，不记堆栈）。 */
class ChannelUserError extends Error {}

/** server.ts 注入的宿主依赖（全部是同一份生产服务）。 */
export interface FeishuChannelHost {
  store: ProductStore;
  conversationExecutor: ConversationExecutor;
  taskRunner: TaskRunner;
  approvals: ApprovalService;
  modeSwitch: ModeSwitchContext;
  /** Server-owned wrappers drain old kernels before changing authority. */
  confirmWorkWithAuthorityDrain?: (
    input: ConfirmWorkInput,
  ) => Promise<ConfirmWorkResult>;
  exitWorkWithAuthorityDrain?: (
    input: ExitWorkInput,
  ) => Promise<ExitWorkResult>;
  conversations: Map<string, Conversation>;
  workspaces: Map<string, Workspace>;
  profiles: Map<string, ModelProfile>;
  resolveApiKey: (profile: ModelProfile) => string;
  /** 订阅 host 事件总线（task/conversation 频道的全部广播）。 */
  subscribe: (listener: (channelId: string, payload: unknown) => void) => () => void;
  getOrHydrateConversation: (conversationId: string) => Conversation | null;
  /** 渠道会话的锚定工作区 id（host 启动时创建，rootPath = 数据目录）。 */
  workspaceId: string;
  log: (line: string) => void;
  now?: () => number;
}

export interface FeishuChannelOptions {
  host: FeishuChannelHost;
  api: FeishuApiClient;
}

interface HostEvent {
  event?: unknown;
  taskId?: unknown;
  runId?: unknown;
  approval?: unknown;
  [key: string]: unknown;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** 长输出纪律：截断 + 指明全文落点（全文永远在产品记录里）。 */
function truncateForChat(text: string, fullRecordHint: string): string {
  if (text.length <= MAX_MESSAGE_CHARS) return text;
  return (
    `${text.slice(0, MAX_MESSAGE_CHARS)}\n\n` +
    `……（已截断，全文见 ${fullRecordHint}）`
  );
}

const HELP_TEXT = `我是蓬莱，住在你机器上的那个它。直接说话就是聊天；指令：

开工 <项目名或路径> <目标>   连接项目并创建任务
任务                        进行中的任务
暂停 / 继续 / 取消 [任务id]   控制当前或指定任务
批准 <审批id> / 拒绝 <审批id>  审批（也可点卡片按钮）
状态                        host · 任务 · 用量概览
完成 / 退出                  结束或暂停当前项目任务，回到普通对话
帮助                        本说明`;

export class FeishuChannel {
  private unsubscribe: (() => void) | null = null;
  private readonly turnCounts = new Map<string, number>();
  private readonly lastProgressAt = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly options: FeishuChannelOptions) {
    this.now = options.host.now ?? Date.now;
  }

  private get host(): FeishuChannelHost {
    return this.options.host;
  }

  private get api(): FeishuApiClient {
    return this.options.api;
  }

  private get store(): ProductStore {
    return this.host.store;
  }

  private log(line: string): void {
    this.host.log(`[feishu] ${line}`);
  }

  // ── 生命周期 ─────────────────────────────────────────────────

  /** 订阅 host 事件总线（进度播报 + 审批卡片推送）。 */
  attach(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.host.subscribe((channelId, payload) => {
      void this.onHostEvent(channelId, payload).catch((error) => {
        this.log(`host event handling failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    // 去重表剪枝（7 天前的行清掉；飞书重投窗口远小于此）。
    try {
      const pruned = this.store.pruneChannelEvents(7 * 24 * 3600_000);
      if (pruned > 0) this.log(`pruned ${pruned} stale dedup rows`);
    } catch (error) {
      this.log(`dedup prune failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  // ── 事件入口（绝不外抛异常：错误在会话内告知，事件一律 ack） ──

  async handleEvent(envelope: FeishuEventEnvelope): Promise<void> {
    try {
      // 幂等：重投事件直接跳过（INSERT OR IGNORE 原子语义）。
      if (!this.store.recordChannelEvent(CHANNEL, envelope.eventId)) {
        this.log(`duplicate event ${envelope.eventId} skipped`);
        return;
      }
      if (envelope.eventType === EVENT_MESSAGE_RECEIVE) {
        await this.handleMessage(extractReceivedMessage(envelope.event));
        return;
      }
      this.log(`ignored event type ${envelope.eventType}`);
    } catch (error) {
      // 处理失败：回滚去重键，让飞书重投能再次尝试（NACK 已发出）。否则
      // 重投会被去重键跳过，事件永久丢失（F2 fix）。
      this.store.forgetChannelEvent(CHANNEL, envelope.eventId);
      this.log(
        `event ${envelope.eventId} failed (dedup rolled back for redelivery): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async handleCardAction(envelope: FeishuEventEnvelope): Promise<unknown> {
    try {
      if (!this.store.recordChannelEvent(CHANNEL, envelope.eventId)) {
        return { toast: { type: "info", content: "该操作已处理过" } };
      }
      if (envelope.eventType !== EVENT_CARD_ACTION) return undefined;
      const action = extractCardAction(envelope.event);
      const identity = action.operatorOpenId
        ? this.store.getChannelIdentity(CHANNEL, action.operatorOpenId)
        : null;
      if (!identity) {
        this.log(`card action from non-whitelisted user ${action.operatorOpenId ?? "?"}`);
        return { toast: { type: "error", content: "未授权用户" } };
      }
      return await this.dispatchCardAction(action.value, identity.identity);
    } catch (error) {
      // 回滚去重键：owner 重发/重投可再试（同 F2 语义）。
      this.store.forgetChannelEvent(CHANNEL, envelope.eventId);
      this.log(
        `card action ${envelope.eventId} failed (dedup rolled back for retry): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return { toast: { type: "error", content: "处理失败，请查看 CLI" } };
    }
  }

  // ── 白名单 ───────────────────────────────────────────────────

  private async handleMessage(msg: FeishuReceivedMessage): Promise<void> {
    if (msg.senderType && msg.senderType !== "user") return; // 机器人/应用消息不理
    if (!msg.chatId) return;
    const openId = msg.senderOpenId;
    if (!openId) return;
    const identity = this.store.getChannelIdentity(CHANNEL, openId);
    if (!identity) {
      // 默认拒绝（单 owner 原则）；告知其 open_id 便于 owner 自助放行。
      this.log(`denied non-whitelisted user ${openId} (chat ${msg.chatId})`);
      await this.safeSendText(
        msg.chatId,
        `未授权用户，已拒绝服务。\n你的 open_id：${openId}\n请 owner 在本机运行：\npenglai channel allow feishu ${openId}`,
      );
      return;
    }
    if (msg.chatType && msg.chatType !== "p2p") {
      // 保守：群聊不服务（待真机联调验证 @ 语义后再开放）。
      this.log(`ignored group message from ${openId} (chat ${msg.chatId})`);
      return;
    }
    if (msg.messageType !== "text") {
      await this.safeSendText(msg.chatId, "目前只支持文本消息（语音/富文本后续里程碑）。");
      return;
    }
    const text = msg.text.trim();
    if (!text) return;
    await this.dispatchText(msg.chatId, identity.identity, text);
  }

  // ── 文本指令分派 ─────────────────────────────────────────────

  private async dispatchText(chatId: string, identity: string, text: string): Promise<void> {
    try {
      const firstToken = text.split(/\s+/, 1)[0];
      const rest = text.slice(firstToken.length).trim();
      switch (firstToken) {
        case "帮助":
        case "help":
        case "/help":
          await this.safeSendText(chatId, HELP_TEXT);
          return;
        case "状态":
          await this.safeSendText(chatId, this.buildStatusText());
          return;
        case "任务":
          await this.safeSendText(chatId, this.buildTaskListText());
          return;
        case "开工":
          await this.safeSendText(chatId, await this.cmdStartWork(chatId, rest));
          return;
        case "暂停":
          await this.safeSendText(chatId, await this.cmdPause(chatId, rest));
          return;
        case "继续":
          await this.safeSendText(chatId, await this.cmdResume(chatId, rest));
          return;
        case "取消":
          await this.safeSendText(chatId, await this.cmdCancel(chatId, rest));
          return;
        case "批准":
          await this.safeSendText(chatId, this.cmdDecide(identity, rest, true));
          return;
        case "拒绝":
          await this.safeSendText(chatId, this.cmdDecide(identity, rest, false));
          return;
        case "完成":
          await this.safeSendText(
            chatId,
            await this.cmdExitWork(chatId, "completed"),
          );
          return;
        case "退出":
          await this.safeSendText(
            chatId,
            await this.cmdExitWork(chatId, "paused"),
          );
          return;
        default:
          await this.chatPassthrough(chatId, text);
      }
    } catch (error) {
      if (error instanceof ChannelUserError) {
        await this.safeSendText(chatId, error.message);
      } else {
        this.log(`command failed: ${error instanceof Error ? error.message : String(error)}`);
        await this.safeSendText(chatId, "处理失败，请查看 CLI（penglai status / task list）。");
      }
    }
  }

  // ── 会话路由（持久化，重启水合） ──────────────────────────────

  private ensureConversation(chatId: string): Conversation {
    const route = this.store.getChannelRoute(CHANNEL, chatId);
    if (route) {
      const existing = this.host.getOrHydrateConversation(route.conversationId);
      if (existing) {
        // 重启水合的对话只带 transcript（对话元数据是内存态，M1′ 已知限制）：
        // modelProfileId 水合为 ""，不补档案聊天会永久 model_error。
        // 渠道侧修复：档案缺失/未知时用当前默认档案补上并落回（路由不丢）。
        if (!this.host.profiles.get(existing.modelProfileId)) {
          const profile = this.resolveDefaultProfile();
          if (profile) {
            const toppedUp: Conversation = {
              ...existing,
              modelProfileId: profile.id,
            };
            this.host.conversations.set(toppedUp.id, toppedUp);
            this.log(`topped up model profile on hydrated conversation ${toppedUp.id}`);
            return toppedUp;
          }
        }
        return existing;
      }
      // 路由在、会话没了（零消息会话重启后不水合）：重建会话并更新路由。
      this.log(`route ${chatId} pointed at a missing conversation; rebinding`);
    }
    const profile = this.resolveDefaultProfile();
    if (!profile) {
      throw new ChannelUserError(
        "还没有可用模型档案：请先在本机 `penglai setup` 配好模型（或 export 内建档案的环境变量）。",
      );
    }
    const timestamp = this.now();
    const conversation: Conversation = {
      schemaVersion: 1,
      id: `conv_${timestamp.toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
      workspaceId: this.host.workspaceId,
      title: `飞书会话 …${chatId.slice(-6)}`,
      status: "idle",
      modelProfileId: profile.id,
      mode: "chat",
      activeTaskId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      endedAt: null,
    };
    this.host.conversations.set(conversation.id, conversation);
    this.store.upsertChannelRoute(CHANNEL, chatId, { conversationId: conversation.id });
    this.log(`routed chat ${chatId} → conversation ${conversation.id}`);
    return conversation;
  }

  /** 第一个 key 就绪的模型档案（与 config.resolveProfile 同语义）。 */
  private resolveDefaultProfile(): ModelProfile | null {
    for (const profile of this.host.profiles.values()) {
      if (this.host.resolveApiKey(profile).trim() !== "") return profile;
    }
    return null;
  }

  // ── 聊天直通（进入统一会话，与 CLI 同一份记录） ───────────────

  private async chatPassthrough(chatId: string, text: string): Promise<void> {
    const conversation = this.ensureConversation(chatId);
    // 水合对话的 workspaceId 可能已失效（工作区是内存态）：显式带上渠道
    // 工作区根（数据目录 = 助理自身地盘），保证读域确定性。
    const workspaceRoot =
      this.host.workspaces.get(this.host.workspaceId)?.rootPath ?? null;
    let result: ConversationPromptResult;
    try {
      result = await this.host.conversationExecutor.prompt({
        conversationId: conversation.id,
        text,
        workspaceRoot,
      });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === "mode_conflict") {
        const mode = getMode(this.host.modeSwitch, conversation.id);
        throw new ChannelUserError(
          `当前对话已锚定任务「${oneLine(mode.task?.title ?? "?", 40)}」（${mode.task?.status ?? "?"}）。\n` +
            `可发：任务 / 暂停 / 继续 / 取消 / 完成 / 退出，或处理审批卡片。`,
        );
      }
      if (code === "conversation_busy") {
        throw new ChannelUserError("上一条还在处理中，稍候再发（或等它说完）。");
      }
      if (code === "model_error") {
        throw new ChannelUserError(
          `模型不可用：${oneLine(error instanceof Error ? error.message : String(error), 200)}`,
        );
      }
      throw error;
    }
    if (result.stopReason !== "completed") {
      await this.safeSendText(
        chatId,
        truncateForChat(
          `${result.text || "（本轮没有文本输出）"}\n\n[episode ${result.stopReason}: ${result.stopDetail ?? ""}]`,
          `会话 transcript（penglai chat --conversation ${conversation.id}）`,
        ),
        `penglai-chat-${result.episodeId}`,
      );
      return;
    }
    await this.safeSendText(
      chatId,
      truncateForChat(
        result.text || "（本轮没有文本输出）",
        `会话 transcript（penglai chat --conversation ${conversation.id}）`,
      ),
      `penglai-chat-${result.episodeId}`,
    );
  }

  // ── 开工（= mode.proposeWork，从聊天里长出工作） ───────────────

  private async cmdStartWork(chatId: string, args: string): Promise<string> {
    const parts = args.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      throw new ChannelUserError("用法：开工 <项目名或路径> <目标>\n例：开工 PenglaiAgent 把构建修绿");
    }
    const [projectRef, ...objectiveParts] = parts;
    const objective = objectiveParts.join(" ").trim();
    const conversation = this.ensureConversation(chatId);
    const project = this.resolveProject(projectRef);
    const proposed = proposeWork(this.host.modeSwitch, {
      conversationId: conversation.id,
      projectId: project.id,
      objective,
      title: objective.slice(0, 60),
      sourceChannel: "feishu",
    });
    this.store.upsertChannelRoute(CHANNEL, chatId, { defaultProjectId: project.id });
    this.log(`开工 proposal ${proposed.proposal.id} awaits Owner confirmation (chat ${chatId})`);
    // 即使项目曾被信任，创建/激活新任务仍需本次 Owner 精确确认。
    await this.safeSendCard(
      chatId,
      buildTrustCard({
        proposalId: proposed.proposal.id,
        conversationId: conversation.id,
        projectName: project.name,
        canonicalRootPath: proposed.proposal.canonicalRootPath,
        title: proposed.proposal.title,
      }),
      `penglai-confirm-work-${proposed.proposal.id}`,
    );
    return `已提出「${oneLine(proposed.proposal.title, 50)}」，等待 Owner 确认工作区（见上方卡片）。`;
  }

  /** 项目解析：路径（含 / 或 ~ 开头）走 rootPath；否则按名称精确/前缀匹配。 */
  private resolveProject(ref: string): Project {
    if (ref.includes("/") || ref.startsWith("~")) {
      throw new ChannelUserError(
        "IM 里暂不支持按新路径锚定（防止误锚）：请先在 CLI `penglai work <路径> \"<目标>\"` 注册该项目，之后飞书里按项目名开工。",
      );
    }
    const projects = this.store.listProjects();
    const exact = projects.filter((p) => p.name === ref || p.name.toLowerCase() === ref.toLowerCase());
    const pool = exact.length > 0 ? exact : projects.filter((p) => p.id.startsWith(ref));
    if (pool.length === 0) {
      const names = projects.map((p) => p.name).join("、") || "（空）";
      throw new ChannelUserError(`没有找到项目「${ref}」。现有项目：${names}`);
    }
    if (pool.length > 1) {
      throw new ChannelUserError(
        `「${ref}」匹配到多个项目：${pool.map((p) => `${p.name}(${shortId(p.id)})`).join("、")}，请用更精确的名称。`,
      );
    }
    return pool[0];
  }

  /** 经 TaskRunner 开工（与 task.start RPC 同检查：trust + profile + key）。 */
  private async startTaskForChannel(task: Task, conversationId: string | null): Promise<Run> {
    const project = this.store.getProject(task.projectId);
    if (!project) throw new ChannelUserError("任务所属项目不存在。");
    if (!project.trusted) {
      throw new ChannelUserError("项目尚未完成 Owner 开工确认。");
    }
    const profile =
      (project.defaultModelProfileId
        ? this.host.profiles.get(project.defaultModelProfileId)
        : null) ?? this.resolveDefaultProfile();
    if (!profile) {
      throw new ChannelUserError("没有 key 就绪的模型档案：请先 `penglai setup`。");
    }
    const apiKey = this.host.resolveApiKey(profile);
    if (!apiKey.trim()) {
      throw new ChannelUserError(`模型档案 ${profile.id} 没有可用 key。`);
    }
    return this.host.taskRunner.start({
      task,
      project,
      profile,
      apiKey,
      source: "feishu",
      mode: "work",
      conversationId,
    });
  }

  // ── 任务控制 ─────────────────────────────────────────────────

  /** 解析任务：显式 id 前缀 > 路由会话锚定任务 > 本会话最近路由的任务。 */
  private resolveTaskForChat(chatId: string, ref: string): Task {
    if (ref) {
      try {
        const task = this.store.resolveTask(ref);
        if (task) return task;
      } catch (error) {
        throw new ChannelUserError(error instanceof Error ? error.message : String(error));
      }
      throw new ChannelUserError(`没有找到任务「${ref}」。`);
    }
    const route = this.store.getChannelRoute(CHANNEL, chatId);
    if (route) {
      const conversation = this.host.getOrHydrateConversation(route.conversationId);
      if (conversation?.activeTaskId) {
        const anchored = this.store.getTask(conversation.activeTaskId);
        if (anchored) return anchored;
      }
    }
    throw new ChannelUserError("没有锚定的任务：先发「开工 <项目> <目标>」，或带上任务 id。");
  }

  private async cmdPause(chatId: string, ref: string): Promise<string> {
    const task = this.resolveTaskForChat(chatId, ref.trim());
    const runId = this.host.taskRunner.activeRunForTask(task.id);
    if (!runId) return `任务「${oneLine(task.title, 40)}」当前没有运行中的 run。`;
    const paused = await this.host.taskRunner.pause(runId);
    return paused
      ? `已暂停「${oneLine(task.title, 40)}」（run ${shortId(runId)}）。发「继续」可从 checkpoint 续跑。`
      : "暂停失败：run 已结束。";
  }

  private async cmdResume(chatId: string, ref: string): Promise<string> {
    const task = this.resolveTaskForChat(chatId, ref.trim());
    if (this.host.taskRunner.activeRunForTask(task.id)) {
      return `任务「${oneLine(task.title, 40)}」正在运行中。`;
    }
    const route = this.store.getChannelRoute(CHANNEL, chatId);
    this.store.putChannelTaskRoute(CHANNEL, task.id, chatId);
    await this.startTaskForChannel(task, route?.conversationId ?? null);
    return `已续跑「${oneLine(task.title, 40)}」（新 run，从 checkpoint 续）。`;
  }

  private async cmdCancel(chatId: string, ref: string): Promise<string> {
    const task = this.resolveTaskForChat(chatId, ref.trim());
    const trackedRunId =
      this.host.taskRunner.activeRunForTask(task.id) ??
      this.host.taskRunner.pendingRunForTask(task.id);
    if (trackedRunId) {
      await this.host.taskRunner.abort(trackedRunId);
      return `已取消「${oneLine(task.title, 40)}」（run ${shortId(trackedRunId)}）。`;
    }
    const bundle = this.store.getTaskBundle(task.id);
    const lastRun = bundle?.runs.at(-1);
    if (lastRun && !["completed", "failed", "cancelled"].includes(lastRun.status)) {
      this.store.transitionRun(lastRun.id, "cancelled", "Cancelled by owner (feishu)");
      return `已取消「${oneLine(task.title, 40)}」（run ${shortId(lastRun.id)}）。`;
    }
    return `任务「${oneLine(task.title, 40)}」没有可取消的 run。`;
  }

  // ── 审批（与 CLI 同一 approval 服务，decidedBy 记飞书身份） ─────

  private cmdDecide(identity: string, args: string, approved: boolean): string {
    const parts = args.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      throw new ChannelUserError(`用法：${approved ? "批准" : "拒绝"} <审批id> [备注]`);
    }
    const [approvalRef, ...noteParts] = parts;
    const note = noteParts.join(" ").trim() || null;
    const decidedBy = `feishu:${identity}`;
    const { approval, grant } = approved
      ? this.host.approvals.approve({ approvalId: approvalRef, decidedBy, note })
      : this.host.approvals.reject({ approvalId: approvalRef, decidedBy, note });
    const verb = approved ? "已批准 ✅" : "已拒绝 ⛔";
    const grantLine = grant ? `\n已记住：本项目「${grant.grantKey}」同类免问。` : "";
    return `${verb} ${shortId(approval.id)} ${oneLine(approval.action, 60)}${grantLine}`;
  }

  // ── 完成 / 退出（mode.exitWork） ──────────────────────────────

  private async cmdExitWork(
    chatId: string,
    outcome: "completed" | "paused",
  ): Promise<string> {
    const route = this.store.getChannelRoute(CHANNEL, chatId);
    const conversation = route
      ? this.host.getOrHydrateConversation(route.conversationId)
      : null;
    if (!conversation) throw new ChannelUserError("当前没有会话。直接说话即可开始聊天。");
    const input = { conversationId: conversation.id, outcome } as const;
    const result = this.host.exitWorkWithAuthorityDrain
      ? await this.host.exitWorkWithAuthorityDrain(input)
      : exitWork(this.host.modeSwitch, input);
    if (!result.changed) return "当前没有锚定项目任务。直接说话即可。";
    return outcome === "completed"
      ? `已离开项目 ✅ 任务「${oneLine(result.task?.title ?? "?", 40)}」标记完成。`
      : "已离开项目（工作暂停，任务保留，之后可「继续」）。";
  }

  // ── 状态 / 任务列表 ──────────────────────────────────────────

  private buildStatusText(): string {
    const projects = this.store.listProjects();
    const counts = new Map<string, number>();
    for (const project of projects) {
      for (const task of this.store.listTasks(project.id)) {
        counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
      }
    }
    const active =
      (counts.get("running") ?? 0) +
      (counts.get("waiting_approval") ?? 0) +
      (counts.get("blocked") ?? 0) +
      (counts.get("ready") ?? 0);
    const pending = this.host.approvals.list({ status: "pending" }).length;
    const usage = this.store.getUsageReport();
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const todayTokens = usage.rows
      .filter((row) => row.day === day)
      .reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0);
    return (
      `📊 蓬莱状态\n` +
      `任务：${active} 进行中（待审批 ${pending}）· 项目 ${projects.length} 个\n` +
      `用量：今日 ${todayTokens} tokens · 累计 ${usage.totalTokens} tokens / ${usage.totalRequests} 次`
    );
  }

  private buildTaskListText(): string {
    const lines: string[] = [];
    for (const project of this.store.listProjects()) {
      for (const task of this.store.listTasks(project.id)) {
        if (["archived", "cancelled"].includes(task.status)) continue;
        lines.push(
          `${this.statusEmoji(task.status)} ${shortId(task.id)} ${oneLine(task.title, 40)} · ${project.name}`,
        );
      }
      if (lines.length >= MAX_LIST_ROWS) break;
    }
    if (lines.length === 0) return "当前没有进行中的任务。发「开工 <项目> <目标>」开一个。";
    return `📋 任务（前 ${Math.min(lines.length, MAX_LIST_ROWS)} 条）\n${lines.slice(0, MAX_LIST_ROWS).join("\n")}`;
  }

  private statusEmoji(status: string): string {
    switch (status) {
      case "running":
        return "🏃";
      case "waiting_approval":
        return "⏸️";
      case "blocked":
        return "🚧";
      case "ready":
        return "🔜";
      case "completed":
        return "✅";
      case "failed":
        return "❌";
      default:
        return "▫️";
    }
  }

  // ── 卡片动作（审批按钮 / Owner 确认开工） ──────────────────────

  private async dispatchCardAction(
    value: Record<string, unknown>,
    identity: string,
  ): Promise<unknown> {
    const kind = typeof value.a === "string" ? value.a : "";
    if (kind === "approve" || kind === "reject") {
      const approvalId = typeof value.id === "string" ? value.id : "";
      const decidedBy = `feishu:${identity}`;
      try {
        const { approval, grant } =
          kind === "approve"
            ? this.host.approvals.approve({ approvalId, decidedBy })
            : this.host.approvals.reject({ approvalId, decidedBy });
        return {
          toast: { type: "success", content: kind === "approve" ? "已批准" : "已拒绝" },
          card: buildApprovalDecidedCard({
            approved: kind === "approve",
            decidedBy,
            note: grant ? `同类免问已记住：${grant.grantKey}` : null,
            action: approval.action,
            taskTitle: this.taskTitle(approval.taskId),
          }),
        };
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === "approval_not_found" || code === "approval_conflict") {
          return { toast: { type: "info", content: "该审批已被处理（或已过期）" } };
        }
        throw error;
      }
    }
    if (kind === "confirm_work") {
      const proposalId = typeof value.proposal === "string" ? value.proposal : "";
      const conversationId = typeof value.conversation === "string" ? value.conversation : "";
      const confirmedRootPath = typeof value.path === "string" ? value.path : "";
      try {
        const input = {
          proposalId,
          conversationId,
          confirmedRootPath,
          confirmedBy: `feishu:${identity}`,
        };
        const confirmed = this.host.confirmWorkWithAuthorityDrain
          ? await this.host.confirmWorkWithAuthorityDrain(input)
          : confirmWork(this.host.modeSwitch, input);
        const chatId = this.store
          .listChannelRoutes(CHANNEL)
          .find((route) => route.conversationId === confirmed.conversation.id)?.chatId;
        if (!chatId) {
          throw new Error("confirmed conversation no longer has a Feishu route");
        }
        this.store.putChannelTaskRoute(CHANNEL, confirmed.task.id, chatId);
        const bundle = this.store.getTaskBundle(confirmed.task.id);
        if (!this.host.taskRunner.activeRunForTask(confirmed.task.id) && (bundle?.runs.length ?? 0) === 0) {
          await this.startTaskForChannel(confirmed.task, confirmed.conversation.id);
        }
        this.log(
          `proposal ${proposalId} confirmed for task ${confirmed.task.id} by ${identity}`,
        );
        return {
          toast: {
            type: "success",
            content: confirmed.idempotent
              ? `「${confirmed.project.name}」已确认并开工`
              : `已确认「${confirmed.project.name}」并开工`,
          },
        };
      } catch (error) {
        return {
          toast: {
            type: "error",
            content: `确认失败：${oneLine(error instanceof Error ? error.message : String(error), 60)}`,
          },
        };
      }
    }
    return { toast: { type: "info", content: "无法识别的操作" } };
  }

  private taskTitle(taskId: string): string {
    return this.store.getTask(taskId)?.title ?? "(unknown task)";
  }

  // ── 进度播报（有界：状态变化即时 + 回合节流） ──────────────────

  private async onHostEvent(channelId: string, payload: unknown): Promise<void> {
    const event = payload as HostEvent;
    if (typeof event.event !== "string") return;
    // 成本熔断播报（design §7）：预算预警/撞线/放行是全局事件，转发到
    // 全部已路由会话（owner 在飞书里第一时间看到）。
    if (event.event.startsWith("budget.")) {
      const message = typeof event.message === "string" ? event.message : "";
      if (!message) return;
      for (const route of this.store.listChannelRoutes(CHANNEL)) {
        await this.safeSendText(route.chatId, message);
      }
      return;
    }
    // 任务频道事件：payload 里带 taskId（task.run.* 生命周期事件）；内核
    // 流事件（turn.completed 等）只有 runId，taskId 就是频道 id 本身。
    const taskId = typeof event.taskId === "string" ? event.taskId : channelId;
    const chatId = this.store.getChannelTaskChat(CHANNEL, taskId);
    if (!chatId) return; // 非本渠道发起的任务不播报（CLI/desktop 有自己的面）

    switch (event.event) {
      case "task.run.started": {
        this.turnCounts.set(String(event.runId ?? ""), 0);
        await this.safeSendText(
          chatId,
          `▶️ 已开始「${oneLine(this.taskTitle(taskId), 50)}」（run ${shortId(String(event.runId ?? ""))}）`,
        );
        return;
      }
      case "turn.completed": {
        const runId = String(event.runId ?? "");
        const turns = (this.turnCounts.get(runId) ?? 0) + 1;
        this.turnCounts.set(runId, turns);
        const last = this.lastProgressAt.get(taskId) ?? 0;
        if (this.now() - last < PROGRESS_THROTTLE_MS) return; // 节流：静默
        this.lastProgressAt.set(taskId, this.now());
        await this.safeSendText(
          chatId,
          `⏳ 进行中「${oneLine(this.taskTitle(taskId), 40)}」：已完成 ${turns} 个回合。（进度播报 ${Math.round(PROGRESS_THROTTLE_MS / 60000)} 分钟节流）`,
        );
        return;
      }
      case "task.run.waiting_approval": {
        const approval = event.approval as Approval | undefined;
        if (!approval) return;
        await this.safeSendCard(
          chatId,
          buildApprovalCard({
            approvalId: approval.id,
            level: approval.capability.startsWith("l3:") ? "L3" : "L2",
            capability: approval.capability,
            action: approval.action,
            reason: approval.reason,
            taskTitle: this.taskTitle(taskId),
          }),
          `penglai-approval-${approval.id}`,
        );
        return;
      }
      case "task.run.resumed": {
        await this.safeSendText(chatId, "✅ 审批已决定，run 继续执行。");
        return;
      }
      case "task.run.completed": {
        await this.safeSendText(
          chatId,
          await this.buildCompletionText(taskId, String(event.runId ?? "")),
        );
        this.lastProgressAt.delete(taskId);
        return;
      }
      case "task.run.failed": {
        await this.safeSendText(
          chatId,
          `❌ 失败「${oneLine(this.taskTitle(taskId), 40)}」\n${oneLine(String(event.message ?? ""), 200)}\n证据与 checkpoint：penglai task show ${shortId(taskId)}`,
        );
        this.lastProgressAt.delete(taskId);
        return;
      }
      case "task.run.blocked": {
        await this.safeSendText(
          chatId,
          `🚧 撞预算停「${oneLine(this.taskTitle(taskId), 40)}」\n${oneLine(String(event.reason ?? ""), 200)}\n可发「继续」开新 run 接着干。`,
        );
        this.lastProgressAt.delete(taskId);
        return;
      }
      case "task.run.paused": {
        await this.safeSendText(chatId, `⏸️ 已暂停「${oneLine(this.taskTitle(taskId), 40)}」。发「继续」续跑。`);
        this.lastProgressAt.delete(taskId);
        return;
      }
      case "task.run.cancelled": {
        await this.safeSendText(chatId, `🛑 已取消「${oneLine(this.taskTitle(taskId), 40)}」。`);
        this.lastProgressAt.delete(taskId);
        return;
      }
      default:
        return;
    }
  }

  /** 完成摘要：状态 + 回合/token + 回复摘录 + Evidence 指针（长输出纪律）。
   *  checkpoint 在 TaskRunner 的 settle 尾段落库（completed 事件先于它到
   *  达），这里短轮询等它出现，超时则降级为无计数摘要。 */
  private async buildCompletionText(taskId: string, runId: string): Promise<string> {
    let bundle = this.store.getTaskBundle(taskId);
    let checkpoint = bundle?.checkpoints.find((c) => c.runId === runId);
    for (let i = 0; !checkpoint && i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      bundle = this.store.getTaskBundle(taskId);
      checkpoint = bundle?.checkpoints.find((c) => c.runId === runId);
    }
    const response = bundle?.evidence.filter((e) => e.title === "Pi Agent response").at(-1);
    const excerpt = response ? oneLine(response.summary, SUMMARY_EXCERPT_CHARS) : "";
    const lines = [
      `✅ 完成「${oneLine(this.taskTitle(taskId), 50)}」`,
      checkpoint
        ? `回合 ${checkpoint.turns} · tokens ${checkpoint.inputTokens + checkpoint.outputTokens} · 证据 ${bundle?.evidence.length ?? 0} 条`
        : `证据 ${bundle?.evidence.length ?? 0} 条`,
    ];
    if (excerpt) lines.push(`\n${excerpt}`);
    lines.push(`\n全文与证据轨：penglai task show ${shortId(taskId)}`);
    return truncateForChat(lines.join("\n"), `任务证据轨（penglai task show ${taskId}）`);
  }

  // ── 发送（uuid 幂等 + 网络错误同 uuid 重试一次） ────────────────

  private async safeSendText(chatId: string, text: string, uuid?: string): Promise<void> {
    const key = uuid ?? `penglai-${crypto.randomUUID()}`;
    try {
      await this.api.sendText(chatId, text, key);
    } catch (error) {
      this.log(`send text failed, retrying once: ${error instanceof Error ? error.message : String(error)}`);
      try {
        await this.api.sendText(chatId, text, key); // 同 uuid：重试不重复投递
      } catch (retryError) {
        this.log(`send text retry failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
      }
    }
  }

  /** Host-owned proactive delivery (companion). Uses the same idempotent
   * retry path as replies and task progress; it never creates another agent
   * loop. */
  async sendProactiveText(chatId: string, text: string): Promise<void> {
    await this.safeSendText(chatId, text, `penglai-companion-${crypto.randomUUID()}`);
  }

  private async safeSendCard(
    chatId: string,
    card: Record<string, unknown>,
    uuid?: string,
  ): Promise<void> {
    const key = uuid ?? `penglai-${crypto.randomUUID()}`;
    try {
      await this.api.sendCard(chatId, card, key);
    } catch (error) {
      this.log(`send card failed, retrying once: ${error instanceof Error ? error.message : String(error)}`);
      try {
        await this.api.sendCard(chatId, card, key);
      } catch (retryError) {
        this.log(`send card retry failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
      }
    }
  }
}
