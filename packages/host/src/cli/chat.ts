/**
 * penglai CLI — the interactive chat REPL (`penglai` / `penglai chat`).
 *
 * Codex-style minimal: readline + streamed text, no TUI framework. The
 * REPL itself is stateless across invocations — the conversation lives in
 * the Host (transcript on disk); "current conversation" resolves to the
 * most recently updated one unless --conversation pins it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { Conversation } from "@penglai/protocol";
import { CliError, type HostClient } from "./client.js";
import { formatVoicePrompt, type VoiceReplDeps } from "./voice.js";
import {
  flagValue,
  oneLine,
  shortId,
  styleFor,
  timeAgo,
  type CliIO,
  type ParsedArgs,
  type Style,
} from "./format.js";

const CLI_IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Permission dial — the ZCode/Codex four modes. Same type as the kernel
 * EpisodePermissionMode; repeated here to avoid a kernel import in the CLI.
 *   plan       read-only research; no edits/commands
 *   confirm    ask before every file edit or command
 *   auto_edit  file edits autonomous; L2 commands ask; L3 always asks
 *   full       fewer confirms; L3 (push/rm/outbound) still always asks
 */
export type CliPermissionMode = "plan" | "confirm" | "auto_edit" | "full";

const PERMISSION_MODES: readonly CliPermissionMode[] = [
  "plan",
  "confirm",
  "auto_edit",
  "full",
] as const;

/** Chinese labels shown in the REPL status line. */
const PERMISSION_LABELS: Record<CliPermissionMode, string> = {
  plan: "计划模式（只读）",
  confirm: "变更前确认",
  auto_edit: "自动编辑",
  full: "完全访问",
};

/** Short badge used in the prompt. */
const PERMISSION_BADGES: Record<CliPermissionMode, string> = {
  plan: "计划",
  confirm: "确认",
  auto_edit: "编辑",
  full: "完全",
};

export function nextPermissionMode(mode: CliPermissionMode): CliPermissionMode {
  const idx = PERMISSION_MODES.indexOf(mode);
  return PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.length]!;
}

/** Resolve the starting dial from CLI flags (--plan/--confirm/--auto-edit/--full). */
export function permissionModeFromFlags(flags: ParsedArgs["flags"]): CliPermissionMode {
  if (flags.plan === true) return "plan";
  if (flags.confirm === true) return "confirm";
  if (flags.full === true) return "full";
  return "auto_edit";
}

function loadCliImage(filePath: string): {
  data: string;
  mimeType: string;
  name: string;
} {
  const resolved = path.resolve(filePath.replace(/^~(?=\/|$)/, process.env.HOME ?? ""));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new CliError(`image not found: ${filePath}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  const mimeType = CLI_IMAGE_MIME[ext];
  if (!mimeType) {
    throw new CliError(`unsupported image type ${ext || "(none)"} — use png/jpg/gif/webp`);
  }
  const buf = fs.readFileSync(resolved);
  if (buf.byteLength > 4 * 1024 * 1024) {
    throw new CliError(`image too large (>4MB): ${filePath}`);
  }
  return {
    data: buf.toString("base64"),
    mimeType,
    name: path.basename(resolved),
  };
}

// ── slash commands ─────────────────────────────────────────────

export type SlashCommand =
  | { kind: "exit" }
  | { kind: "mode" }
  | { kind: "new" }
  | { kind: "voice" }
  | { kind: "help" }
  | { kind: "goal"; text: string | null }
  | { kind: "goal_clear" }
  | { kind: "compact"; instructions: string | null }
  | { kind: "pin"; kindPin: "file" | "skill" | "note" | "mcp" | "url" | "session"; ref: string; label: string | null }
  | { kind: "unpin"; ref: string }
  | { kind: "pins" }
  | { kind: "image"; path: string; caption: string | null }
  | { kind: "unknown"; raw: string }
  | { kind: "prompt"; text: string };

/** Parse one REPL input line: a slash command or a plain prompt. */
export function parseSlashCommand(line: string): SlashCommand {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return { kind: "prompt", text: line };
  const parts = trimmed.split(/\s+/);
  const word = (parts[0] ?? "").toLowerCase();
  const rest = trimmed.slice(parts[0].length).trim();
  switch (word) {
    case "/exit":
    case "/quit":
    case "/q":
      return { kind: "exit" };
    case "/mode":
      return { kind: "mode" };
    case "/new":
      return { kind: "new" };
    case "/voice":
    case "/v":
      return { kind: "voice" };
    case "/help":
    case "/?":
      return { kind: "help" };
    case "/goal":
      if (!rest || rest === "clear" || rest === "--clear") {
        return rest === "clear" || rest === "--clear"
          ? { kind: "goal_clear" }
          : { kind: "goal", text: null };
      }
      return { kind: "goal", text: rest };
    case "/goalclear":
    case "/cleargoal":
      return { kind: "goal_clear" };
    case "/compact":
      return { kind: "compact", instructions: rest || null };
    case "/pin": {
      if (!rest) return { kind: "unknown", raw: word };
      // /pin [file|skill|note|mcp|url|session] <ref> [as label...]
      const pinParts = rest.split(/\s+/);
      const kinds = new Set(["file", "skill", "note", "mcp", "url", "session"]);
      let kindPin: "file" | "skill" | "note" | "mcp" | "url" | "session" = "note";
      let idx = 0;
      if (kinds.has(pinParts[0] ?? "")) {
        kindPin = pinParts[0] as typeof kindPin;
        idx = 1;
      } else if (pinParts[0]?.startsWith("/") || pinParts[0]?.startsWith("~")) {
        kindPin = "file";
      } else if ((pinParts[0] ?? "").startsWith("conv_")) {
        kindPin = "session";
      }
      const ref = pinParts[idx] ?? "";
      if (!ref) return { kind: "unknown", raw: word };
      let label: string | null = null;
      const asIdx = pinParts.indexOf("as", idx + 1);
      if (asIdx >= 0) {
        label = pinParts.slice(asIdx + 1).join(" ").trim() || null;
      } else if (pinParts.length > idx + 1) {
        label = pinParts.slice(idx + 1).join(" ").trim() || null;
      }
      return { kind: "pin", kindPin, ref, label };
    }
    case "/unpin":
      if (!rest) return { kind: "unknown", raw: word };
      return { kind: "unpin", ref: rest };
    case "/pins":
      return { kind: "pins" };
    case "/image":
    case "/img": {
      if (!rest) return { kind: "unknown", raw: word };
      // /image <path> [caption...]
      const sp = rest.match(/^("([^"]+)"|'([^']+)'|(\S+))\s*(.*)$/);
      const path =
        sp?.[2] || sp?.[3] || sp?.[4] || rest.split(/\s+/, 1)[0] || "";
      const caption = (sp?.[5] ?? "").trim() || null;
      if (!path) return { kind: "unknown", raw: word };
      return { kind: "image", path, caption };
    }
    default:
      return { kind: "unknown", raw: word };
  }
}

// ── conversation resolution ────────────────────────────────────

async function openConversation(
  client: HostClient,
  args: ParsedArgs,
  io: CliIO,
  style: Style,
  forceNew: boolean,
): Promise<Conversation> {
  const pinned = flagValue(args.flags, "conversation");
  if (pinned && !forceNew) {
    const got = await client.rpc("conversation.get", { conversationId: pinned });
    return got.conversation as Conversation;
  }
  if (!forceNew) {
    const conversations = (await client.rpc("conversation.list", {})) as Conversation[];
    if (conversations.length > 0) return conversations[0];
  }
  // Fresh conversation on the first model profile that resolves a key
  // host-side. workspaceId is retained as legacy UI metadata only: the Host
  // gives this floating conversation its own dataDir/drafts/<conversationId>
  // root, so registering cwd here does not grant file access.
  const profileId = flagValue(args.flags, "profile");
  const resolved = await client.rpc(
    "config.resolveProfile",
    profileId ? { profileId } : {},
  );
  if (!resolved.profile) {
    throw new CliError(
      "no model profile has an API key — run `penglai setup`（首次运行向导）, " +
        "set GROK_API_KEY / DEEPSEEK_API_KEY / ZAI_API_KEY / OPENAI_API_KEY, " +
        "or `penglai config add` a custom endpoint",
    );
  }
  if (!resolved.hasKey) {
    const env = resolved.profile.apiKeyEnv || "the matching";
    throw new CliError(
      `profile '${resolved.profile.id}' has no API key — set ${env} env var first`,
    );
  }
  const workspace = await client.rpc("workspace.open", {
    rootPath: process.cwd(),
    name: `cli:${process.cwd().split("/").pop() ?? "cwd"}`,
  });
  const conversation = await client.rpc("conversation.create", {
    workspaceId: workspace.id,
    modelProfileId: resolved.profile.id,
    title: "New conversation",
  });
  io.line(
    style.dim(`new conversation ${conversation.id} on profile ${resolved.profile.id}`),
  );
  return conversation as Conversation;
}

// ── prompt rendering ───────────────────────────────────────────

interface PromptRenderState {
  sawDelta: boolean;
}

async function runPrompt(
  client: HostClient,
  conversation: Conversation,
  text: string,
  io: CliIO,
  style: Style,
  permissionMode: CliPermissionMode,
  images?: Array<{ data: string; mimeType: string; name?: string }>,
): Promise<string> {
  const state: PromptRenderState = { sawDelta: false };
  const unsubscribe = await client.subscribe(conversation.id, async (event) => {
    switch (event.event) {
      case "conversation.delta":
        if (typeof event.textDelta === "string") {
          state.sawDelta = true;
          io.out(event.textDelta);
        }
        break;
      case "conversation.tool.started":
        io.line(style.dim(`  ⚙ ${String(event.toolName ?? "tool")}…`));
        break;
      case "conversation.tool.completed":
        io.line(
          style.dim(
            `  ⚙ ${String(event.toolName ?? "tool")} ${event.isError ? "failed" : "done"}`,
          ),
        );
        break;
      case "conversation.mode.changed": {
        const task = event.task as { id?: string; title?: string } | undefined;
        io.line("");
        io.line(
          style.cyan(
            `→ 项目已锚定并开立任务 ${task?.id ? shortId(task.id) : ""} ` +
              `"${oneLine(task?.title ?? "", 48)}"`,
          ),
        );
        io.line(
          style.dim(
            `  penglai task start ${task?.id ?? ""} 开工；/mode 查看当前模式`,
          ),
        );
        break;
      }
      case "conversation.approval.requested": {
        const approval = (event as { approval?: {
          id: string; level: string; capability: string; action: string;
        } }).approval;
        if (!approval) break;
        const level = approval.level;
        const isL3 = level === "L3";
        // L3 always asks. L2 asks unless the dial already auto-approves L2
        // (auto_edit/full). In auto_edit/full, the kernel auto-approves L2
        // before this event is ever emitted, so reaching here means L3.
        io.line("");
        io.line(
          (isL3 ? style.red : style.yellow)(
            `  ⚠ ${level} 审批：${approval.action}`,
          ),
        );
        // Ask inline. The agent is parked waiting for this decision.
        const answer = await new Promise<string>((resolve) => {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl.question(
            isL3 ? "  批准此操作？[y/N] " : "  批准？[Y/n] ",
            (a) => {
              rl.close();
              resolve(a.trim().toLowerCase());
            },
          );
        });
        const approved = isL3
          ? answer === "y" || answer === "yes"
          : answer !== "n" && answer !== "no";
        try {
          await client.rpc(
            approved
              ? "conversation.approval.approve"
              : "conversation.approval.reject",
            {
              approvalId: approval.id,
              decidedBy: "cli:owner",
              ...(approved && isL3 ? {} : { rememberSession: !isL3 }),
            },
          );
          io.line(style.dim(approved ? "  已批准，继续…" : "  已拒绝。"));
        } catch (error) {
          io.line(style.red(`  审批失败：${error instanceof Error ? error.message : String(error)}`));
        }
        break;
      }
      case "conversation.prompt.blocked":
        io.line(style.yellow(`\n[已熔断: ${String(event.reason ?? "")}]`));
        break;
      case "budget.warning":
      case "budget.tripped":
      case "budget.lifted":
        // 成本熔断播报（用量核对播到会话频道；全局 budget 频道经 status 面板可见）。
        io.line(
          (event.event === "budget.tripped" ? style.red : style.yellow)(
            `\n[预算] ${String(event.message ?? "")}`,
          ),
        );
        break;
      default:
        break;
    }
  });

  let aborted = false;
  const onSigint = (): void => {
    if (aborted) return;
    aborted = true;
    void client.rpc("conversation.abort", { conversationId: conversation.id }).catch(() => undefined);
  };
  process.on("SIGINT", onSigint);
  try {
    const result = await client.rpc("conversation.prompt", {
      conversationId: conversation.id,
      text,
      permissionMode,
      images: images && images.length > 0 ? images : undefined,
    });
    if (state.sawDelta) io.line("");
    if (result.stopReason === "aborted") {
      io.line(style.yellow("[已中断]"));
    } else if (result.stopReason === "budget") {
      io.line(style.yellow(`[episode 撞预算: ${result.stopDetail}]`));
    }
    if (!state.sawDelta && result.text) io.line(result.text);
    return String(result.text ?? "");
  } finally {
    process.removeListener("SIGINT", onSigint);
    unsubscribe();
  }
}

// ── the REPL ───────────────────────────────────────────────────

export async function cmdChatRepl(
  client: HostClient,
  args: ParsedArgs,
  io: CliIO,
  /** Test seam: a prepared stdin replacement. */
  replInput?: NodeJS.ReadableStream,
  /** 统一会话语音 I/O 层（--voice 或 /voice 启用；缺省纯文本）。 */
  voice?: VoiceReplDeps,
): Promise<number> {
  const style = styleFor(io.tty);
  let conversation = await openConversation(
    client,
    args,
    io,
    style,
    args.flags.new === true,
  );

  // Permission dial (ZCode/Codex four modes). Survives for the REPL session;
  // /mode cycles it. L3 (push/rm/outbound) always asks regardless of dial.
  let permissionMode = permissionModeFromFlags(args.flags);

  io.line(
    style.dim(
      `penglai 0.4.0 · ${conversation.mode === "work" ? "项目锚定" : "浮动"} · ${shortId(conversation.id)} "${oneLine(conversation.title, 40)}"`,
    ),
  );
  if (conversation.goal?.trim()) {
    io.line(style.cyan(`🎯 goal: ${oneLine(conversation.goal, 72)}`));
  }
  io.line(
    style.dim(
      "/exit · /mode 切档 · /new · /goal · /compact · /pin · /image · /voice · /help",
    ),
  );
  io.line(
    style.cyan(
      `  档位：${PERMISSION_LABELS[permissionMode]}（/mode 循环切换；L3 外发/删除永远询问）`,
    ),
  );

  const promptFor = (mode: CliPermissionMode): string =>
    style.bold(`[${PERMISSION_BADGES[mode]}] you › `);

  const rl = readline.createInterface({
    input: replInput ?? process.stdin,
    output: process.stdout,
    prompt: promptFor(permissionMode),
    terminal: replInput === undefined,
  });
  rl.prompt();

  let busy = false;
  let quitting = false;
  // 语音开关（--voice 起始启用）：开 = 回车空行说话、回复播报（TTS 就绪时）。
  let voiceOn = args.flags.voice === true && voice !== undefined;

  /** /voice 开关：开时如实报告引擎就绪度与补装指引。 */
  async function toggleVoice(): Promise<void> {
    if (!voice) {
      io.line(style.yellow("语音不可用（本进程未挂语音层）——纯文本模式。"));
      return;
    }
    voiceOn = !voiceOn;
    if (!voiceOn) {
      io.line(style.dim("语音已关（纯文本）。"));
      return;
    }
    const status = await voice.status().catch(() => null);
    if (!status) {
      io.line(style.yellow("语音引擎探测失败——本回合仍是纯文本；penglai doctor 查 voice 行。"));
      return;
    }
    if (!status.asr.ready) {
      io.line(style.yellow(`语音输入未就绪：${status.asr.detail}`));
      io.line(style.dim("  补装：penglai voice setup（约 230MB）——空行说话暂不可用，打字照常。"));
      return;
    }
    io.line(style.green("语音已开：回车空行说话（Enter 结束录音）。"));
    if (!status.tts.ready) {
      io.line(style.dim(`  语音播报未启用：${status.tts.detail}（回复仍以文本显示）`));
    } else {
      io.line(style.dim("  回复将用本地 TTS 播报（数据不出机）。"));
    }
  }

  /** 语音回合：录音 → 转写（情绪标签注入上下文）→ 复用文本 prompt 链路。 */
  async function voiceTurn(): Promise<void> {
    if (!voice) return;
    const status = await voice.status().catch(() => null);
    if (!status?.asr.ready) {
      io.line(style.yellow(`语音输入未就绪：${status?.asr.detail ?? "探测失败"}（penglai voice setup 补装；打字照常）`));
      return;
    }
    io.out(style.dim("🎙 录音中…（Enter 结束）"));
    const recording = await voice.record();
    io.out("\r" + " ".repeat(30) + "\r");
    if (!recording) {
      io.line(style.yellow("没录到音（无麦克风或 ffmpeg 不可用）——打字照常。"));
      return;
    }
    const transcribed = await voice.transcribe(recording.wavBase64, recording.format);
    if (!transcribed.ok) {
      io.line(style.yellow(`转写失败：${transcribed.error ?? "未知"}——打字照常。`));
      return;
    }
    if (transcribed.noSpeech || !transcribed.text) {
      io.line(style.dim("没听清（未检出语音）——再说一次或打字。"));
      return;
    }
    io.line(style.cyan(`🎙 [${transcribed.emotion ?? "NEUTRAL"}] ${transcribed.text}`));
    // 语音只是 I/O 层：情绪标签随文本进 conversation.prompt——
    // 蒸馏/审批/预算/transcript 全部走既有链路，天然兼容。
    const reply = await runPrompt(
      client,
      conversation,
      formatVoicePrompt(transcribed.text, transcribed.emotion, transcribed.language),
      io,
      style,
      permissionMode,
    );
    // 语音输出：TTS 就绪才播报；未就绪静默跳过（开关时已提示）。
    if (voiceOn && reply.trim() && status.tts.ready) {
      const spoken = await voice.synthesize(reply).catch(() => null);
      if (spoken?.ok && spoken.wavBase64) {
        await voice.play(spoken.wavBase64).catch(() => undefined);
      } else if (spoken && !spoken.ok) {
        io.line(style.dim(`  （播报失败：${spoken.error ?? "未知"}）`));
      }
    }
  }

  rl.on("SIGINT", () => {
    // During a prompt, SIGINT aborts the episode (handled in runPrompt);
    // at the prompt line it exits like other shells.
    if (!busy && !quitting) {
      quitting = true;
      rl.close();
    }
  });

  for await (const line of rl) {
    const command = parseSlashCommand(line);
    if (command.kind === "exit") break;
    if (command.kind === "help") {
      io.line("/exit 退出 · /mode 当前模式 · /new 新会话 · /voice 语音开关");
      io.line("/goal [text] 设定/查看目标 · /goal clear 清除 · /compact [说明] 显式压缩上下文");
      io.line("/pin [file|skill|note|mcp|url|session] <ref> [as label] · /unpin · /pins");
      io.line("/image <路径> [说明] 附图片发送（png/jpg/gif/webp ≤4MB）");
      io.line(style.dim("其他: penglai task|mode|work|memory|status|doctor|voice — penglai help"));
    } else if (command.kind === "image") {
      busy = true;
      try {
        const img = loadCliImage(command.path);
        io.line(style.dim(`🖼 ${img.name} (${img.mimeType})`));
        await runPrompt(
          client,
          conversation,
          command.caption ?? "请查看这张图片。",
          io,
          style,
          permissionMode,
          [img],
        );
      } catch (error) {
        io.line(style.red(error instanceof Error ? error.message : String(error)));
      } finally {
        busy = false;
      }
    } else if (command.kind === "unknown") {
      io.line(style.yellow(`unknown command ${command.raw} — /help`));
    } else if (command.kind === "voice") {
      busy = true;
      try {
        await toggleVoice();
      } finally {
        busy = false;
      }
    } else if (command.kind === "goal") {
      busy = true;
      try {
        if (command.text === null) {
          const got = await client.rpc("conversation.goal.get", {
            conversationId: conversation.id,
          });
          const g = (got.goal as string | null) ?? null;
          if (g?.trim()) {
            io.line(style.cyan(`🎯 goal: ${g}`));
          } else {
            io.line(style.dim("no goal set — /goal <text> to set one (defaults dial to plan)"));
          }
          const pins = (got.contextPins as Array<{ kind: string; label: string; ref: string }> | undefined) ?? [];
          if (pins.length > 0) {
            for (const pin of pins) {
              io.line(style.dim(`  pin [${pin.kind}] ${pin.label} → ${pin.ref}`));
            }
          }
        } else {
          // ZCode session/goal often starts a turn; kick a plan episode so
          // the owner immediately sees orientation (still one conversation).
          const result = await client.rpc("conversation.goal.set", {
            conversationId: conversation.id,
            goal: command.text,
            kick: true,
          });
          conversation = result.conversation as Conversation;
          io.line(style.cyan(`🎯 goal set: ${oneLine(conversation.goal ?? "", 72)}`));
          io.line(style.dim("  plan dial · kicked orientation turn (switch to 自动编辑/完全访问再执行)"));
          // kick may stream via conversation channel; if result text is present, print it.
          const kick = result.kick as { text?: string; stopReason?: string } | null;
          if (kick?.text) {
            if (!kick.text.endsWith("\n")) io.line("");
            io.line(kick.text);
          }
        }
      } catch (error) {
        io.line(style.red(error instanceof Error ? error.message : String(error)));
      } finally {
        busy = false;
      }
    } else if (command.kind === "goal_clear") {
      busy = true;
      try {
        const result = await client.rpc("conversation.goal.clear", {
          conversationId: conversation.id,
        });
        conversation = result.conversation as Conversation;
        io.line(style.dim("goal cleared"));
      } catch (error) {
        io.line(style.red(error instanceof Error ? error.message : String(error)));
      } finally {
        busy = false;
      }
    } else if (command.kind === "compact") {
      busy = true;
      try {
        const result = await client.rpc("conversation.compact", {
          conversationId: conversation.id,
          instructions: command.instructions ?? undefined,
        });
        if (result.deferred) {
          io.line(style.dim(`compact deferred: ${String(result.note ?? result.detail ?? "")}`));
        } else if (result.ok) {
          io.line(style.green(`compacted${result.detail ? `: ${result.detail}` : ""}`));
        } else {
          io.line(style.yellow(`compact failed: ${String(result.detail ?? result.note ?? "")}`));
        }
      } catch (error) {
        io.line(style.red(error instanceof Error ? error.message : String(error)));
      } finally {
        busy = false;
      }
    } else if (command.kind === "pin") {
      busy = true;
      try {
        const result = await client.rpc("conversation.pin.add", {
          conversationId: conversation.id,
          kind: command.kindPin,
          ref: command.ref,
          label: command.label ?? undefined,
        });
        conversation = result.conversation as Conversation;
        const pin = result.pin as { kind: string; label: string; ref: string };
        io.line(style.cyan(`📌 pinned [${pin.kind}] ${pin.label}`));
      } catch (error) {
        io.line(style.red(error instanceof Error ? error.message : String(error)));
      } finally {
        busy = false;
      }
    } else if (command.kind === "unpin") {
      busy = true;
      try {
        const result = await client.rpc("conversation.pin.remove", {
          conversationId: conversation.id,
          ref: command.ref,
          pinId: command.ref.startsWith("pin_") ? command.ref : undefined,
        });
        conversation = result.conversation as Conversation;
        io.line(style.dim(`unpinned (${result.removed ?? 0})`));
      } catch (error) {
        io.line(style.red(error instanceof Error ? error.message : String(error)));
      } finally {
        busy = false;
      }
    } else if (command.kind === "pins") {
      busy = true;
      try {
        const got = await client.rpc("conversation.goal.get", {
          conversationId: conversation.id,
        });
        const pins =
          (got.contextPins as Array<{ id: string; kind: string; label: string; ref: string }> | undefined) ??
          [];
        if (pins.length === 0) {
          io.line(style.dim("no pins — /pin file path/to/file or /pin skill name"));
        } else {
          for (const pin of pins) {
            io.line(`  ${shortId(pin.id)} [${pin.kind}] ${pin.label} → ${pin.ref}`);
          }
        }
      } catch (error) {
        io.line(style.red(error instanceof Error ? error.message : String(error)));
      } finally {
        busy = false;
      }
    } else if (command.kind === "mode") {
      // /mode cycles the permission dial (plan/confirm/auto_edit/full).
      // The project anchor (mode.get) is a separate concern shown on demand.
      permissionMode = nextPermissionMode(permissionMode);
      rl.setPrompt(promptFor(permissionMode));
      io.line(
        style.cyan(
          `  档位 → ${PERMISSION_LABELS[permissionMode]}` +
            (permissionMode === "plan"
              ? "（只读研究；编辑/命令需切回其他档）"
              : permissionMode === "full"
                ? "（L3 外发/删除/推送仍会询问）"
                : ""),
        ),
      );
      // Also refresh anchor status for context.
      const anchor = await client
        .rpc("mode.get", { conversationId: conversation.id })
        .catch(() => null);
      if (anchor) {
        conversation = { ...conversation, mode: anchor.mode, activeTaskId: anchor.activeTaskId };
        if (anchor.task) {
          io.line(style.dim(`  锚定：项目 · task ${shortId(anchor.task.id)} "${oneLine(anchor.task.title, 40)}"`));
        }
      }
    } else if (command.kind === "new") {
      conversation = await openConversation(client, args, io, style, true);
      if (conversation.goal?.trim()) {
        io.line(style.cyan(`🎯 goal: ${oneLine(conversation.goal, 72)}`));
      }
    } else if (command.kind === "prompt" && !command.text.trim() && voiceOn) {
      // 语音开时的空行 = 说话（录音→转写→复用文本 prompt 链路）。
      busy = true;
      try {
        await voiceTurn();
      } catch (error) {
        io.line(style.red(error instanceof Error ? error.message : String(error)));
      } finally {
        busy = false;
      }
    } else if (command.kind === "prompt" && command.text.trim()) {
      busy = true;
      try {
        await runPrompt(client, conversation, command.text, io, style, permissionMode);
        // An explicit Owner-facing mode RPC may have changed the anchor.
        const refreshed = await client
          .rpc("mode.get", { conversationId: conversation.id })
          .catch(() => null);
        if (refreshed) {
          conversation = {
            ...conversation,
            mode: refreshed.mode,
            activeTaskId: refreshed.activeTaskId,
          };
        }
      } catch (error) {
        io.line("");
        io.line(style.red(error instanceof Error ? error.message : String(error)));
      } finally {
        busy = false;
      }
    }
    if (!quitting) {
      // Keep the prompt in sync with the current dial.
      try {
        rl.setPrompt(promptFor(permissionMode));
      } catch {
        /* readline closed */
      }
      // A piped/test input stream may have closed the interface already.
      try {
        rl.prompt();
      } catch {
        /* readline closed: the for-await drain will end the loop */
      }
    }
  }
  rl.close();
  io.line(style.dim(`bye — conversation ${shortId(conversation.id)} · ${timeAgo(Date.now(), Date.now())}`));
  return 0;
}

/** `penglai chat --list`: recent conversations, non-interactive. */
export async function cmdChatList(
  client: HostClient,
  io: CliIO,
): Promise<number> {
  const style = styleFor(io.tty);
  const conversations = (await client.rpc("conversation.list", {})) as Conversation[];
  if (conversations.length === 0) {
    io.line(style.dim("no conversations yet"));
    return 0;
  }
  for (const conversation of conversations.slice(0, 20)) {
    io.line(
      `${conversation.mode.padEnd(5)} ${shortId(conversation.id)} ${oneLine(conversation.title, 52)} ${style.dim(`· ${timeAgo(conversation.updatedAt)}`)}`,
    );
  }
  return 0;
}
