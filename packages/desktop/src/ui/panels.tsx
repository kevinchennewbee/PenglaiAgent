/**
 * 范围纪律面板：进行中（active）、渠道（展示）、能力（语音/预算/技能树
 * 入口展示）、设置（模型档案查看 + budget 状态）。渠道管理与技能树管理
 * 在 CLI —— 桌面首版只读展示，不藏功能，如实指路。
 */

import { useEffect, useState } from "react";
import type {
  BudgetStatus,
  ModelProfile,
  Project,
  SopMeta,
  Task,
  UsageReport,
} from "@penglai/protocol";
import type { RuntimeHandshake } from "@penglai/protocol";
import type { ChannelInfo, CompanionStatus, VoiceStatus } from "../hooks/useWorkbenchData.js";
import type { PenglaiBridge } from "../bridge/types.js";
import {
  dimensionLabel,
  dimensionSeverity,
  taskStatusLabel,
  type ProjectNode,
} from "../state/workbench.js";
import { formatRatio, formatTokens, timeAgo } from "../state/format.js";
import { Icon } from "./Icon.js";
import { publicHref } from "./MarkdownMessage.js";

// ── 进行中 ─────────────────────────────────────────────────────

export function ActivePanel({
  nodes,
  conversations,
  onOpenTask,
  onOpenConversation,
}: {
  nodes: ProjectNode[];
  conversations: { id: string; title: string; mode: string; status: string; updatedAt: number; activeTaskId?: string | null }[];
  onOpenTask: (taskId: string) => void;
  onOpenConversation: (id: string) => void;
}) {
  const live: Array<{ project: Project; task: Task }> = [];
  for (const node of nodes) {
    for (const task of node.tasks) {
      if (["running", "waiting_approval", "blocked"].includes(task.status)) {
        live.push({ project: node.project, task });
      }
    }
  }
  return (
    <main className="task-surface">
      <header className="task-header">
        <div>
          <p>正在进行的任务与会话</p>
          <h1>进行中</h1>
        </div>
      </header>
      <section className="task-content">
        <div className="panel-stack">
          {live.length === 0 && (
            <div className="new-task-intro">
              <div className="brand-seal intro">蓬</div>
              <h2>此刻没有执行中的任务</h2>
              <p>从对话里说一句话，活就会在项目 jail 里长出来。</p>
            </div>
          )}
          {live.map(({ project, task }) => {
            const anchored = conversations.find((c) => c.activeTaskId === task.id);
            return (
            <button
              className="info-card row-link"
              key={task.id}
              onClick={() => {
                if (anchored) onOpenConversation(anchored.id);
                else onOpenTask(task.id);
              }}
            >
              <div>
                <strong>{task.title}</strong>
                <small>{project.name} · {taskStatusLabel(task.status)} · {timeAgo(task.updatedAt)}</small>
              </div>
              <Icon name="chevron" size={15} />
            </button>
            );
          })}
          {conversations.length > 0 && (
            <section className="info-card">
              <h3>最近会话</h3>
              {conversations.slice(0, 8).map((conversation) => (
                <button
                  className="row-link slim"
                  key={conversation.id}
                  onClick={() => onOpenConversation(conversation.id)}
                >
                  <span className={`mode-chip ${conversation.mode}`}>
                    {conversation.activeTaskId ? "有工作区" : "助理目录"}
                  </span>
                  <span>{conversation.title}</span>
                  <small>{timeAgo(conversation.updatedAt)}</small>
                </button>
              ))}
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

// ── 渠道（目录卡片 + 飞书接入闭环；微信诚实占位/Host 化中） ──────

function channelStateLabel(state: string): { text: string; ok: boolean } {
  const normalized = (state || "").toLowerCase();
  if (normalized === "connected" || normalized === "open" || normalized === "live") {
    return { text: "已连接", ok: true };
  }
  if (normalized === "connecting" || normalized === "reconnecting" || normalized === "starting") {
    return { text: "连接中", ok: false };
  }
  if (normalized === "stopped" || normalized === "idle") return { text: "已停用", ok: false };
  if (normalized === "unconfigured") return { text: "未配置", ok: false };
  if (normalized === "bound_polling" || normalized === "bound_no_runtime" || normalized === "token_saved") {
    return { text: "已绑定 · 轮询中/待启动", ok: false };
  }
  if (normalized === "error") return { text: "异常", ok: false };
  if (normalized === "coming_soon") return { text: "即将接入", ok: false };
  return { text: state || "未知", ok: false };
}

export function ChannelsPanel({
  channels,
  bridge,
  onChanged,
}: {
  channels: ChannelInfo[];
  bridge?: PenglaiBridge;
  onChanged?: () => void;
}) {
  const feishu = channels.find((channel) => channel.channel === "feishu") ?? null;
  const wechat = channels.find((channel) => channel.channel === "wechat") ?? null;
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [allowId, setAllowId] = useState("");
  const [wechatAllowId, setWechatAllowId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showFeishuSetup, setShowFeishuSetup] = useState(false);
  const [feishuQrUrl, setFeishuQrUrl] = useState<string | null>(null);
  const [feishuQrStatus, setFeishuQrStatus] = useState<string | null>(null);
  const [wechatQrUrl, setWechatQrUrl] = useState<string | null>(null);
  const [wechatQrStatus, setWechatQrStatus] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    if (!bridge || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      onChanged?.();
    } catch (error) {
      setNotice(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  };

  const pollUntil = async <T extends { status: string }>(
    tick: () => Promise<T>,
    done: (row: T) => boolean,
    maxMs = 180_000,
  ): Promise<T> => {
    const start = Date.now();
    let last = await tick();
    while (!done(last) && Date.now() - start < maxMs) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      last = await tick();
    }
    return last;
  };

  const feishuState = channelStateLabel(feishu?.state ?? "stopped");
  const wechatState = channelStateLabel(wechat?.state ?? "unconfigured");
  const safeFeishuQrUrl = publicHref(feishuQrUrl ?? undefined);
  const safeWechatQrUrl = publicHref(wechatQrUrl ?? undefined);

  return (
    <main className="task-surface">
      <header className="task-header">
        <div>
          <p>IM 渠道 · 远程监视 + 审批器 · Host 单一真相</p>
          <h1>渠道</h1>
        </div>
      </header>
      <section className="task-content">
        <div className="panel-stack channel-catalog">
          <section className="info-card">
            <div className="approval-head">
              <Icon name="message" size={15} />
              <strong>飞书</strong>
              <span className={`level-chip ${feishuState.ok ? "l2" : "l3"}`}>{feishuState.text}</span>
            </div>
            <dl>
              <div><dt>配置</dt><dd>{feishu?.configured ? "已配置" : "未配置"}</dd></div>
              <div><dt>启用</dt><dd>{feishu?.enabled ? "是" : "否"}</dd></div>
              <div><dt>App</dt><dd>{feishu?.appId ?? "—"}</dd></div>
              <div><dt>白名单身份</dt><dd>{feishu?.whitelist ?? 0}</dd></div>
              <div><dt>会话路由</dt><dd>{feishu?.routes ?? 0}</dd></div>
            </dl>
            <div className="channel-actions">
              <button
                type="button"
                className="primary-button"
                disabled={!bridge || busy}
                onClick={() =>
                  void run(async () => {
                    const started = await bridge!.rpc<{
                      sessionId: string;
                      qrUrl: string;
                      status: string;
                      intervalSec?: number;
                    }>("channel.feishu.qrStart", {});
                    setFeishuQrUrl(started.qrUrl);
                    setFeishuQrStatus(started.status);
                    setNotice("请用手机飞书扫码…");
                    const final = await pollUntil(
                      () =>
                        bridge!.rpc<{
                          sessionId: string;
                          status: string;
                          appId: string | null;
                          configured: boolean;
                          error: string | null;
                          qrUrl: string;
                        }>("channel.feishu.qrPoll", { sessionId: started.sessionId }),
                      (row) => ["confirmed", "denied", "expired", "error"].includes(row.status),
                    );
                    setFeishuQrStatus(final.status);
                    if (final.status === "confirmed" && final.appId && final.configured) {
                      setAppId(final.appId);
                      setNotice("飞书已接入。私聊机器人拿 open_id，再加白名单。");
                      setFeishuQrUrl(null);
                    } else {
                      setNotice(final.error || `扫码未完成：${final.status}`);
                    }
                  })
                }
              >
                扫码接入飞书
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!bridge || busy}
                onClick={() => setShowFeishuSetup((open) => !open)}
              >
                {showFeishuSetup ? "收起手贴" : "手贴密钥"}
              </button>
              {feishu?.configured && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!bridge || busy}
                  onClick={() =>
                    void run(async () => {
                      await bridge!.rpc("channel.disable", { channel: "feishu" });
                      setNotice("飞书已停用");
                    })
                  }
                >
                  停用
                </button>
              )}
            </div>
            {feishuQrUrl && (
              <div className="channel-setup-form">
                <p className="muted">扫码状态：{feishuQrStatus ?? "pending"}</p>
                {safeFeishuQrUrl
                  ? <a href={safeFeishuQrUrl} target="_blank" rel="noopener noreferrer">打开扫码页 / 复制链接</a>
                  : <span className="unsafe-link">扫码地址协议无效，已阻止打开</span>}
                <code className="muted" style={{ wordBreak: "break-all" }}>{feishuQrUrl}</code>
              </div>
            )}
            {showFeishuSetup && (
              <div className="channel-setup-form">
                <label>
                  App ID
                  <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="cli_…" spellCheck={false} />
                </label>
                <label>
                  App Secret
                  <input
                    type="password"
                    value={appSecret}
                    onChange={(e) => setAppSecret(e.target.value)}
                    placeholder="密钥只发给本机 Host"
                    spellCheck={false}
                  />
                </label>
                <div className="channel-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!bridge || busy || !appId.trim() || !appSecret.trim()}
                    onClick={() =>
                      void run(async () => {
                        await bridge!.rpc("channel.setup", {
                          channel: "feishu",
                          appId: appId.trim(),
                          appSecret: appSecret.trim(),
                        });
                        setAppSecret("");
                        setNotice("飞书已配置并尝试连接。请私聊机器人获取 open_id，再加入白名单。");
                      })
                    }
                  >
                    保存并连接
                  </button>
                </div>
                <label>
                  白名单 open_id（机器人拒绝回复里会带）
                  <input
                    value={allowId}
                    onChange={(e) => setAllowId(e.target.value)}
                    placeholder="ou_…"
                    spellCheck={false}
                  />
                </label>
                <div className="channel-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!bridge || busy || !allowId.trim()}
                    onClick={() =>
                      void run(async () => {
                        await bridge!.rpc("channel.allow", {
                          channel: "feishu",
                          channelUserId: allowId.trim(),
                          identity: "owner",
                        });
                        setAllowId("");
                        setNotice("已加入飞书白名单");
                      })
                    }
                  >
                    添加白名单
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="info-card">
            <div className="approval-head">
              <Icon name="message" size={15} />
              <strong>微信</strong>
              <span className={`level-chip ${wechatState.ok ? "l2" : "l3"}`}>{wechatState.text}</span>
            </div>
            <dl>
              <div>
                <dt>Token</dt>
                <dd>
                  {wechat?.configured
                    ? wechatState.ok
                      ? "已绑定 · 消息桥运行中"
                      : "已绑定 · 桥未运行"
                    : "无"}
                </dd>
              </div>
              <div><dt>Bot</dt><dd>{wechat?.appId ?? "—"}</dd></div>
              <div><dt>白名单</dt><dd>{wechat?.whitelist ?? 0}</dd></div>
              <div><dt>路由会话</dt><dd>{wechat?.routes ?? 0}</dd></div>
            </dl>
            <div className="channel-actions">
              <button
                type="button"
                className="primary-button"
                disabled={!bridge || busy}
                onClick={() =>
                  void run(async () => {
                    const started = await bridge!.rpc<{
                      sessionId: string;
                      qrUrl: string;
                      status: string;
                    }>("channel.wechat.qrStart", {});
                    setWechatQrUrl(started.qrUrl);
                    setWechatQrStatus(started.status);
                    setNotice("请用手机微信扫码…");
                    const final = await pollUntil(
                      () =>
                        bridge!.rpc<{
                          status: string;
                          botId: string | null;
                          error: string | null;
                          tokenSaved: boolean;
                          qrUrl: string;
                        }>("channel.wechat.qrPoll", { sessionId: started.sessionId }),
                      (row) => ["confirmed", "expired", "error"].includes(row.status),
                      240_000,
                    );
                    setWechatQrStatus(final.status);
                    if (final.status === "confirmed" && final.tokenSaved) {
                      setNotice("微信已绑 token，消息桥已启动。请把用户加入白名单后发消息。");
                      setWechatQrUrl(null);
                    } else {
                      setNotice(final.error || `扫码未完成：${final.status}`);
                    }
                  })
                }
              >
                扫码接入微信
              </button>
              {wechat?.configured && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!bridge || busy}
                  onClick={() =>
                    void run(async () => {
                      await bridge!.rpc("channel.wechat.clear", {});
                      setNotice("已清除微信 token");
                    })
                  }
                >
                  清除绑定
                </button>
              )}
            </div>
            {wechatQrUrl && (
              <div className="channel-setup-form">
                <p className="muted">扫码状态：{wechatQrStatus ?? "pending"}</p>
                {/* iLink returns a scannable content URL; open or render via external QR if needed */}
                {safeWechatQrUrl
                  ? <a href={safeWechatQrUrl} target="_blank" rel="noopener noreferrer">打开/复制二维码内容</a>
                  : <span className="unsafe-link">二维码内容不是安全网页地址，仅显示文本</span>}
                <code className="muted" style={{ wordBreak: "break-all" }}>{wechatQrUrl}</code>
              </div>
            )}
            <div className="channel-setup-form">
              <label>
                白名单用户 id（微信 openid / ilink user id）
                <input
                  value={wechatAllowId}
                  onChange={(e) => setWechatAllowId(e.target.value)}
                  placeholder="扫码后对方发消息可见"
                  spellCheck={false}
                />
              </label>
              <div className="channel-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!bridge || busy || !wechatAllowId.trim()}
                  onClick={() =>
                    void run(async () => {
                      await bridge!.rpc("channel.allow", {
                        channel: "wechat",
                        channelUserId: wechatAllowId.trim(),
                        identity: "owner",
                      });
                      setWechatAllowId("");
                      setNotice("已加入微信白名单");
                    })
                  }
                >
                  添加微信白名单
                </button>
              </div>
            </div>
          </section>

          {notice && <p className="composer-notice" role="status">{notice}</p>}
        </div>
      </section>
    </main>
  );
}

// ── 能力（语音 / 预算 / 技能树入口展示） ───────────────────────

export function AbilitiesPanel({
  voice,
  companion,
  budget,
  sops,
  onInstallVoice,
  voiceInstallLog,
  voiceInstalling,
  activeConversationId,
  onCompanion,
}: {
  voice: VoiceStatus | null;
  companion: CompanionStatus | null;
  budget: BudgetStatus | null;
  sops: SopMeta[];
  /** Desktop installs SenseVoice / MOSS-TTS via host voice.install (same as CLI). */
  onInstallVoice?: (which: "asr" | "tts" | "all") => void;
  voiceInstallLog?: string | null;
  voiceInstalling?: boolean;
  activeConversationId?: string | null;
  onCompanion?: (
    action: "enable" | "disable" | "mode" | "trigger",
    input?: { mode?: "quiet" | "present" | "active"; conversationId?: string | null },
  ) => void;
}) {
  const component = (
    label: string,
    status: { ready: boolean; detail: string } | undefined,
  ) => (
    <div className="ability-row">
      <span className={status?.ready ? "ability-dot ok" : "ability-dot"} />
      <strong>{label}</strong>
      <small>{status ? status.detail : "未探测"}</small>
    </div>
  );
  return (
    <main className="task-surface">
      <header className="task-header">
        <div>
          <p>同一对话 · Owner 选择项目与权限 · 外部工具默认关闭</p>
          <h1>能力</h1>
        </div>
      </header>
      <section className="task-content">
        <div className="panel-stack">
          <section className="info-card">
            <h3>语音（本地 ASR + TTS · 数据不出机）</h3>
            {component("语音识别 ASR（SenseVoice ~230MB）", voice?.asr)}
            {component("语音合成 TTS（MOSS-TTS-Nano ~728MB）", voice?.tts)}
            {component("ffmpeg（录音/播放）", voice?.ffmpeg)}
            <div className="wizard-actions" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
              <button
                className="primary-button"
                type="button"
                disabled={voiceInstalling || !onInstallVoice || voice?.asr?.ready}
                onClick={() => onInstallVoice?.("asr")}
              >
                {voice?.asr?.ready ? "ASR 已就绪" : voiceInstalling ? "下载中…" : "下载 ASR 模型"}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={voiceInstalling || !onInstallVoice || voice?.tts?.ready}
                onClick={() => onInstallVoice?.("tts")}
              >
                {voice?.tts?.ready ? "TTS 已就绪" : voiceInstalling ? "下载中…" : "下载 TTS 模型"}
              </button>
              <button
                className="link-button"
                type="button"
                disabled={voiceInstalling || !onInstallVoice}
                onClick={() => onInstallVoice?.("all")}
              >
                两个一起装
              </button>
            </div>
            {voiceInstallLog && (
              <pre className="muted" style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 12 }}>
                {voiceInstallLog}
              </pre>
            )}
            <p className="muted">
              模型落在本机数据目录（默认 <code>~/.penglai/models/</code>），镜像优先 + 断点续传；
              也可 CLI：<code>penglai voice setup</code> / <code>penglai voice setup --tts</code>。
              chat 内：<code>penglai chat --voice</code>。
            </p>
          </section>
          <section className="info-card">
            <h3>主动陪伴（本地状态 · 默认关闭）</h3>
            <div className="ability-row">
              <span className={companion?.enabled ? "ability-dot ok" : "ability-dot"} />
              <strong>{companion?.enabled ? "已启用" : "未启用"}</strong>
              <small>
                {companion?.enabled
                  ? `${companion.mode} · 勿扰/冷却 · 同一 EpisodeRunner`
                  : "由你明确开启；不会另起 agent 或绕过审批"}
              </small>
            </div>
            <div className="wizard-actions" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
              <select
                value={companion?.mode ?? "present"}
                aria-label="主动陪伴强度"
                onChange={(event) =>
                  onCompanion?.("mode", {
                    mode: event.target.value as "quiet" | "present" | "active",
                  })
                }
              >
                <option value="quiet">安静（仅情绪承接）</option>
                <option value="present">在场（推荐）</option>
                <option value="active">主动</option>
              </select>
              <button
                className="primary-button"
                type="button"
                onClick={() =>
                  onCompanion?.(companion?.enabled ? "disable" : "enable", {
                    mode: companion?.mode ?? "present",
                    conversationId: activeConversationId ?? null,
                  })
                }
              >
                {companion?.enabled ? "关闭主动陪伴" : "为当前对话开启"}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!companion?.enabled}
                onClick={() => onCompanion?.("trigger")}
              >
                立即测试一次
              </button>
            </div>
            <p className="muted">
              保留 0.3.x 的 opt-in、勿扰、情绪承接与主动短消息；周期心跳只提交内部观察事件，模型生成仍走同一核心。
            </p>
          </section>
          <section className="info-card">
            <h3>预算熔断</h3>
            {budget ? (
              <>
                <div className="ability-row">
                  <span className="ability-dot ok" />
                  <strong>全局日上限</strong>
                  <small>
                    {budget.config.dailyTokenLimit === null
                      ? "未设上限"
                      : formatTokens(budget.config.dailyTokenLimit)}
                  </small>
                </div>
                <div className="ability-row">
                  <span className="ability-dot ok" />
                  <strong>每项目日上限</strong>
                  <small>
                    {budget.config.projectDailyTokenLimit === null
                      ? "未设上限"
                      : formatTokens(budget.config.projectDailyTokenLimit)}
                  </small>
                </div>
              </>
            ) : (
              <p className="muted">读取中…</p>
            )}
            <p className="muted">80% 预警、100% 熔断降级为审批模式；配置与放行在「设置」。</p>
          </section>
          <section className="info-card">
            <h3>技能树（{sops.length} 条 SOP）</h3>
            {sops.slice(0, 8).map((sop) => (
              <div className="ability-row" key={sop.name}>
                <span className="ability-dot ok" />
                <strong>{sop.title || sop.name}</strong>
                <small>{timeAgo(sop.updatedAt)}</small>
              </div>
            ))}
            {sops.length === 0 && <p className="muted">蒸馏环产出的 SOP 会入树 — 目前为空。</p>}
            <p className="muted">
              技能树 = 蒸馏审计通过的 SOP。对话内用 <code>skill_list</code> /{" "}
              <code>skill_show</code>；也可 CLI：
              <code>penglai memory sop list/show/remove</code>。
            </p>
          </section>
          <section className="info-card">
            <h3>常用交付能力</h3>
            <div className="ability-row">
              <span className="ability-dot ok" />
              <strong>文档 / PDF</strong>
              <small>读取 PDF、DOCX、XLSX、PPTX 与常用文本；可新建真实 PDF</small>
            </div>
            <div className="ability-row">
              <span className="ability-dot ok" />
              <strong>网页搜索 / 抓取</strong>
              <small>公网限定与 SSRF 防护 · 每次 Owner L3</small>
            </div>
            <div className="ability-row">
              <span className="ability-dot" />
              <strong>browser / MCP</strong>
              <small>0.4.0 继续隔离；需要独立信任与执行边界</small>
            </div>
            <p className="muted">Git、压缩、日志、测试和进程检查由文件与 bash 原子工具完成，不重复做专用按钮或任务卡。</p>
          </section>
        </div>
      </section>
    </main>
  );
}

// ── 设置（模型 / 用量 / 工具面 / 技能 / 运行时） ────────────

export interface DesktopUpdateInfo {
  has_update: boolean;
  version: string;
  body: string;
}

export type UsageStatsView = {
  range: string;
  totalTokens: number;
  totalRequests: number;
  activeDays: number;
  currentStreakDays: number;
  topModel: { model: string; tokens: number; share: number } | null;
  daily: Array<{ day: string; tokens: number; requests: number }>;
  byModel: Array<{ model: string; tokens: number; requests: number; share: number }>;
  activeDaySet: string[];
};

export function SettingsPanel({
  profiles,
  profileKeyMap,
  defaultProfileId,
  budget,
  usage,
  usageStats = null,
  usageStatsRange = "30d",
  onUsageRange,
  handshake,
  homeDir,
  projects,
  busy,
  onSetBudget,
  onLiftBudget,
  onOpenWizard,
  update,
  updateChecking,
  updateError,
  installingUpdate,
  onCheckUpdate,
  onInstallUpdate,
  bridge = null,
  sops = [],
  onProfilesChanged,
}: {
  profiles: ModelProfile[];
  profileKeyMap: Map<string, boolean>;
  defaultProfileId: string | null;
  budget: BudgetStatus | null;
  usage: UsageReport | null;
  usageStats?: UsageStatsView | null;
  usageStatsRange?: "7d" | "30d" | "all";
  onUsageRange?: (range: "7d" | "30d" | "all") => void;
  handshake: RuntimeHandshake | null;
  homeDir: string | null;
  projects: Project[];
  busy: boolean;
  onSetBudget: (daily: number | null, perProject: number | null) => void;
  onLiftBudget: (dimension: string) => void;
  onOpenWizard: () => void;
  update: DesktopUpdateInfo | null;
  updateChecking: boolean;
  updateError: string | null;
  installingUpdate: boolean;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  bridge?: PenglaiBridge | null;
  sops?: SopMeta[];
  onProfilesChanged?: () => void;
}) {
  const [dailyInput, setDailyInput] = useState<string>("");
  const [perProjectInput, setPerProjectInput] = useState<string>("");
  const [inputsReady, setInputsReady] = useState(false);
  const [tab, setTab] = useState<"models" | "usage" | "tools" | "skills" | "runtime">("models");
  const [editProfileId, setEditProfileId] = useState("");
  const [editContextTokens, setEditContextTokens] = useState("");
  const [profileSaveNotice, setProfileSaveNotice] = useState<string | null>(null);
  const [toolSurface, setToolSurface] = useState<{
    local: string[];
    network: string[];
    optional: string[];
    notes: string[];
  } | null>(null);
  const [mcpServers, setMcpServers] = useState<
    Array<{ id: string; name: string; enabled: boolean; transport: string; command?: string; url?: string }>
  >([]);
  const [mcpRuntimes, setMcpRuntimes] = useState<
    Array<{ id: string; name: string; status: string; detail: string; tools: string[] }>
  >([]);
  const [installedSkills, setInstalledSkills] = useState<Array<{
    name: string; description: string; source: string; enabled: boolean; sha256: string; updatedAt: number;
  }>>([]);
  const [skillSource, setSkillSource] = useState("");
  const [mcpName, setMcpName] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"stdio" | "http" | "sse">("stdio");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [integrationNotice, setIntegrationNotice] = useState<string | null>(null);
  const [sopPreview, setSopPreview] = useState<{ name: string; content: string } | null>(null);
  if (budget && !inputsReady) {
    setDailyInput(budget.config.dailyTokenLimit?.toString() ?? "");
    setPerProjectInput(budget.config.projectDailyTokenLimit?.toString() ?? "");
    setInputsReady(true);
  }
  const parse = (text: string): number | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const value = Number(trimmed);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  };
  const maxDaily = Math.max(1, ...(usageStats?.daily.map((d) => d.tokens) ?? [1]));

  useEffect(() => {
    if (!bridge) return;
    if (tab !== "tools" && tab !== "skills") return;
    let cancelled = false;
    void bridge
      .rpc<{
        servers: Array<{ id: string; name: string; enabled: boolean; transport: string; command?: string; url?: string }>;
        runtimes?: Array<{ id: string; name: string; status: string; detail: string; tools: string[] }>;
        tools: { local: string[]; network: string[]; optional: string[]; notes: string[] };
      }>("mcp.list")
      .then((result) => {
        if (cancelled) return;
        setMcpServers(result.servers ?? []);
        setMcpRuntimes(result.runtimes ?? []);
        setToolSurface(result.tools ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setToolSurface({
            local: ["read / write / edit / bash", "document_read", "document_create_pdf"],
            network: ["web_search / web_fetch（Owner L3）"],
            optional: ["Skills；browser / MCP 当前隔离"],
            notes: ["Host 未返回工具面；按 W1 fail-closed 显示。"],
          });
        }
      });
    if (tab === "skills") {
      void bridge.rpc<{ installed: typeof installedSkills }>("skill.list").then((result) => {
        if (!cancelled) setInstalledSkills(result.installed ?? []);
      }).catch(() => {
        if (!cancelled) setInstalledSkills([]);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [bridge, tab]);

  const reloadMcp = async () => {
    if (!bridge) return;
    const result = await bridge.rpc<{
      servers: typeof mcpServers;
      runtimes: typeof mcpRuntimes;
      tools: NonNullable<typeof toolSurface>;
    }>("mcp.list");
    setMcpServers(result.servers ?? []);
    setMcpRuntimes(result.runtimes ?? []);
    setToolSurface(result.tools ?? null);
  };

  const runIntegration = async (action: () => Promise<void>) => {
    if (integrationBusy) return;
    setIntegrationBusy(true);
    setIntegrationNotice(null);
    try {
      await action();
    } catch (error) {
      setIntegrationNotice(`失败：${String(error instanceof Error ? error.message : error)}`);
    } finally {
      setIntegrationBusy(false);
    }
  };

  return (
    <main className="task-surface">
      <header className="task-header">
        <div>
          <p>模型 · 工具面 · 技能 · 用量 · 运行时</p>
          <h1>设置</h1>
        </div>
      </header>
      <section className="task-content">
        <div className="settings-tabs">
          {(
            [
              ["models", "模型"],
              ["tools", "工具与联网"],
              ["skills", "技能"],
              ["usage", "用量与预算"],
              ["runtime", "运行时"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "settings-tab active" : "settings-tab"}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="panel-stack">
          {tab === "models" && (
          <section className="info-card">
            <h3>模型档案（{profiles.length}）</h3>
            {profiles.map((profile) => {
              const windowTokens =
                typeof profile.contextWindowTokens === "number" && profile.contextWindowTokens > 0
                  ? profile.contextWindowTokens
                  : null;
              const windowLabel = windowTokens
                ? windowTokens % 1000 === 0
                  ? `${windowTokens / 1000}k`
                  : String(windowTokens)
                : "未知（可改）";
              return (
                <div className="ability-row" key={profile.id}>
                  <span className={profileKeyMap.get(profile.id) ? "ability-dot ok" : "ability-dot"} />
                  <strong>
                    {profile.label}
                    {profile.id === defaultProfileId && <em className="default-mark">默认</em>}
                  </strong>
                  <small>
                    {profile.model} · 窗口 {windowLabel}
                    {profile.capabilities?.vision ? " · 视觉" : ""}
                    {" · "}
                    {profileKeyMap.get(profile.id) ? "key 已就绪" : "缺 key"}
                  </small>
                </div>
              );
            })}
            {bridge && (
              <div className="wizard-reentry" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <select
                  className="input"
                  value={editProfileId}
                  onChange={(e) => {
                    setEditProfileId(e.target.value);
                    const p = profiles.find((row) => row.id === e.target.value);
                    setEditContextTokens(
                      p?.contextWindowTokens && p.contextWindowTokens > 0
                        ? String(p.contextWindowTokens)
                        : "",
                    );
                  }}
                >
                  <option value="">选择档案以设置上下文窗口</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  value={editContextTokens}
                  onChange={(e) => setEditContextTokens(e.target.value)}
                  placeholder="上下文 tokens（如 1000000）"
                  inputMode="numeric"
                  style={{ minWidth: "14rem" }}
                />
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!editProfileId.trim() || !editContextTokens.trim()}
                  onClick={() => {
                    const value = Number(editContextTokens.trim());
                    if (!editProfileId || !Number.isFinite(value) || value <= 0) return;
                    void bridge
                      .rpc("config.updateProfile", {
                        id: editProfileId,
                        contextWindowTokens: Math.floor(value),
                      })
                      .then(() => {
                        setProfileSaveNotice(`已保存窗口 ${Math.floor(value)} tokens`);
                        onProfilesChanged?.();
                      })
                      .catch((error) => setProfileSaveNotice(`保存失败：${String(error)}`));
                  }}
                >
                  保存窗口
                </button>
              </div>
            )}
            {profileSaveNotice && <p className="muted">{profileSaveNotice}</p>}
            <div className="wizard-reentry">
              <button className="secondary-button" onClick={onOpenWizard}>
                <Icon name="plus" size={14} />重新配置模型（首次启动向导）
              </button>
            </div>
            <p className="muted">
              目录内模型带官方 context_k（如 DeepSeek 1000k、部分 256k）；自定义模型可手填窗口。
              新增档案/换端点走向导；key 永不离开 Host。
            </p>
          </section>
          )}

          {tab === "usage" && (
          <>
          <section className="info-card">
            <div className="budget-row-head" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>使用统计</h3>
              <div className="settings-tabs compact">
                {(["7d", "30d", "all"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={usageStatsRange === r ? "settings-tab active" : "settings-tab"}
                    onClick={() => onUsageRange?.(r)}
                  >
                    {r === "7d" ? "7 天" : r === "30d" ? "30 天" : "全部"}
                  </button>
                ))}
              </div>
            </div>
            <div className="usage-kpi-grid">
              <div className="usage-kpi">
                <small>tokens</small>
                <strong>{formatTokens(usageStats?.totalTokens ?? usage?.totalTokens ?? 0)}</strong>
              </div>
              <div className="usage-kpi">
                <small>请求</small>
                <strong>{usageStats?.totalRequests ?? usage?.totalRequests ?? 0}</strong>
              </div>
              <div className="usage-kpi">
                <small>活跃天</small>
                <strong>{usageStats?.activeDays ?? 0}</strong>
              </div>
              <div className="usage-kpi">
                <small>连续天</small>
                <strong>{usageStats?.currentStreakDays ?? 0}</strong>
              </div>
              <div className="usage-kpi">
                <small>最常用模型</small>
                <strong>
                  {usageStats?.topModel
                    ? `${usageStats.topModel.model} · ${Math.round(usageStats.topModel.share * 100)}%`
                    : "—"}
                </strong>
              </div>
            </div>
            {usageStats && usageStats.daily.length > 0 && (
              <div className="usage-bars" aria-label="按天用量">
                {usageStats.daily.slice(-30).map((d) => (
                  <div
                    key={d.day}
                    className="usage-bar"
                    title={`${d.day}: ${formatTokens(d.tokens)}`}
                    style={{ height: `${Math.max(4, Math.round((d.tokens / maxDaily) * 64))}px` }}
                  />
                ))}
              </div>
            )}
            {usageStats && usageStats.byModel.length > 0 && (
              <div className="usage-models">
                {usageStats.byModel.slice(0, 6).map((m) => (
                  <div className="ability-row" key={m.model}>
                    <span className="ability-dot ok" />
                    <strong>{m.model}</strong>
                    <small>
                      {formatTokens(m.tokens)} · {Math.round(m.share * 100)}%
                    </small>
                  </div>
                ))}
              </div>
            )}
            {(!usageStats || (usageStats.totalTokens === 0 && usageStats.byModel.length === 0)) && (
              <p className="muted">有对话/任务用量后这里会显示趋势与模型占比（Host usage.stats）。</p>
            )}
          </section>

          <section className="info-card">
            <h3>预算（成本熔断）</h3>
            {budget?.dimensions.map((dimension) => {
              const severity = dimensionSeverity(dimension);
              return (
                <div className={`budget-row ${severity}`} key={dimension.dimension}>
                  <div className="budget-row-head">
                    <span>{dimensionLabel(dimension.dimension, projects)}</span>
                    <span>
                      {formatTokens(dimension.usedTokens)} /{" "}
                      {dimension.limitTokens === null ? "∞" : formatTokens(dimension.limitTokens)}
                      {" · "}{formatRatio(dimension.ratio)}
                    </span>
                  </div>
                  {dimension.tripped && !dimension.lifted && (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => onLiftBudget(dimension.dimension)}
                    >
                      放行此维度（今日）
                    </button>
                  )}
                </div>
              );
            })}
            <div className="budget-form">
              <label>
                <span>全局日上限（token，空 = 不限）</span>
                <input
                  value={dailyInput}
                  onChange={(event) => setDailyInput(event.target.value)}
                  placeholder="例如 200000"
                  inputMode="numeric"
                />
              </label>
              <label>
                <span>每项目日上限</span>
                <input
                  value={perProjectInput}
                  onChange={(event) => setPerProjectInput(event.target.value)}
                  placeholder="例如 100000"
                  inputMode="numeric"
                />
              </label>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => onSetBudget(parse(dailyInput), parse(perProjectInput))}
              >
                保存预算
              </button>
            </div>
            {usage && (
              <p className="muted">
                累计 {formatTokens(usage.totalTokens)}（{usage.totalRequests} 次）· 80% 预警 · 100% 审批熔断
              </p>
            )}
          </section>
          </>
          )}


          {tab === "tools" && (
            <>
              <section className="info-card">
                <h3>当前工具面</h3>
                {toolSurface ? (
                  <>
                    <p><strong>本地</strong>：{toolSurface.local.join(" · ")}</p>
                    <p><strong>联网</strong>：{toolSurface.network.join(" · ")}</p>
                    <p><strong>可选</strong>：{toolSurface.optional.join(" · ")}</p>
                    <ul className="muted">
                      {toolSurface.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="muted">读取 Host 工具面…</p>
                )}
                <p className="muted">
                  Bash 按命令风险走 L1-L4；Web 与每次 MCP 工具调用都由 Owner L3 决定；browser 不内置。
                </p>
              </section>
              <section className="info-card">
                <h3>MCP（{mcpServers.length}）· 手动连接</h3>
                <div className="budget-form" style={{ marginBottom: 12 }}>
                  <label><span>名称</span><input value={mcpName} onChange={(e) => setMcpName(e.target.value)} placeholder="例如 filesystem" /></label>
                  <label><span>传输</span><select value={mcpTransport} onChange={(e) => setMcpTransport(e.target.value as typeof mcpTransport)}><option value="stdio">stdio</option><option value="http">HTTP</option><option value="sse">SSE</option></select></label>
                  {mcpTransport === "stdio" ? (
                    <>
                      <label><span>命令</span><input value={mcpCommand} onChange={(e) => setMcpCommand(e.target.value)} placeholder="npx / absolute command" /></label>
                      <label><span>参数（逐行）</span><textarea value={mcpArgs} onChange={(e) => setMcpArgs(e.target.value)} placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path"} /></label>
                    </>
                  ) : (
                    <label><span>公网 URL</span><input value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} placeholder="https://…" /></label>
                  )}
                  <button className="secondary-button" disabled={!bridge || integrationBusy || !mcpName.trim()} onClick={() => void runIntegration(async () => {
                    await bridge!.rpc("mcp.upsert", {
                      name: mcpName.trim(), transport: mcpTransport,
                      command: mcpTransport === "stdio" ? mcpCommand.trim() : undefined,
                      args: mcpTransport === "stdio" ? mcpArgs.split("\n").map((v) => v.trim()).filter(Boolean) : undefined,
                      url: mcpTransport === "stdio" ? undefined : mcpUrl.trim(), enabled: true,
                    });
                    setMcpName(""); setMcpCommand(""); setMcpArgs(""); setMcpUrl("");
                    await reloadMcp(); setIntegrationNotice("MCP 配置已保存；尚未连接。")
                  })}>保存配置</button>
                </div>
                <div className="wizard-reentry" style={{ gap: 8, marginBottom: 10 }}>
                  <button className="primary-button" disabled={!bridge || integrationBusy || mcpServers.length === 0} onClick={() => void runIntegration(async () => { await bridge!.rpc("mcp.connect"); await reloadMcp(); setIntegrationNotice("已手动连接启用的 MCP；每次工具调用仍需 L3。") })}>连接已启用 MCP</button>
                  <button className="secondary-button" disabled={!bridge || integrationBusy} onClick={() => void runIntegration(async () => { await bridge!.rpc("mcp.disconnect"); await reloadMcp(); setIntegrationNotice("MCP 已全部断开。") })}>全部断开</button>
                </div>
                {mcpServers.length === 0 && (
                  <p className="muted">
                    还没有 MCP。保存配置不会自动启动；只有点击“连接”才会 spawn/联网。
                  </p>
                )}
                {mcpServers.map((server) => {
                  const runtime = mcpRuntimes.find((r) => r.id === server.id);
                  const live = runtime?.status === "connected";
                  return (
                    <div className="ability-row" key={server.id}>
                      <span className={live ? "ability-dot ok" : server.enabled ? "ability-dot" : "ability-dot"} />
                      <strong>{server.name}</strong>
                      <small>
                        {server.transport}
                        {server.command ? ` · ${server.command}` : ""}
                        {server.url ? ` · ${server.url}` : ""}
                        {runtime ? ` · ${runtime.status}: ${runtime.detail}` : ""}
                      </small>
                      <button className="link-button" disabled={!bridge || integrationBusy} onClick={() => void runIntegration(async () => { await bridge!.rpc("mcp.remove", { id: server.id }); await reloadMcp(); })}>删除</button>
                    </div>
                  );
                })}
                <p className="muted">
                  Host 启动时绝不自动连接。stdio 使用私有临时 HOME；HTTP/SSE 逐跳防 SSRF；配置中的 env/header 值不会回传 renderer。
                </p>
                {integrationNotice && <p className="muted">{integrationNotice}</p>}
              </section>
            </>
          )}

          {tab === "skills" && (
            <section className="info-card">
              <h3>Skills（安装 {installedSkills.length} · 蒸馏 SOP {sops.length}）</h3>
              <div className="wizard-reentry" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <input className="input" style={{ flex: "1 1 26rem" }} value={skillSource} onChange={(e) => setSkillSource(e.target.value)} placeholder="本地 Skill 文件夹 / SKILL.md，或 GitHub tree / raw SKILL.md URL" />
                <button className="primary-button" disabled={!bridge || integrationBusy || !skillSource.trim()} onClick={() => void runIntegration(async () => {
                  await bridge!.rpc("skill.install", { source: skillSource.trim() });
                  const result = await bridge!.rpc<{ installed: typeof installedSkills }>("skill.list");
                  setInstalledSkills(result.installed ?? []); setSkillSource(""); setIntegrationNotice("Skill 已校验、收据化并启用；新回合开始挂载。")
                })}>安装 Skill</button>
              </div>
              {installedSkills.map((skill) => (
                <div className="ability-row" key={`installed-${skill.name}`}>
                  <span className={skill.enabled ? "ability-dot ok" : "ability-dot"} />
                  <strong>{skill.name}</strong>
                  <small>{skill.description} · {skill.source} · {skill.sha256.slice(0, 10)}</small>
                  <button className="link-button" disabled={!bridge || integrationBusy} onClick={() => void runIntegration(async () => {
                    await bridge!.rpc("skill.enable", { name: skill.name, enabled: !skill.enabled });
                    const result = await bridge!.rpc<{ installed: typeof installedSkills }>("skill.list"); setInstalledSkills(result.installed ?? []);
                  })}>{skill.enabled ? "停用" : "启用"}</button>
                  <button className="link-button" disabled={!bridge || integrationBusy} onClick={() => void runIntegration(async () => {
                    const result = await bridge!.rpc<{ content: string }>("skill.inspect", { name: skill.name }); setSopPreview({ name: skill.name, content: result.content });
                  })}>查看</button>
                  <button className="link-button" disabled={!bridge || integrationBusy} onClick={() => void runIntegration(async () => {
                    await bridge!.rpc("skill.remove", { name: skill.name });
                    const result = await bridge!.rpc<{ installed: typeof installedSkills }>("skill.list"); setInstalledSkills(result.installed ?? []);
                  })}>卸载</button>
                </div>
              ))}
              {sops.length === 0 && <p className="muted">蒸馏环通过后的 SOP 会出现在这里。</p>}
              {sops.map((sop) => (
                <div className="ability-row" key={sop.name}>
                  <span className="ability-dot ok" />
                  <strong>{sop.title || sop.name}</strong>
                  <small>{timeAgo(sop.updatedAt)}</small>
                  {bridge && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        void bridge
                          .rpc<{ name: string; content: string } | string>("memory.sopShow", { name: sop.name })
                          .then((result) => {
                            if (typeof result === "string") setSopPreview({ name: sop.name, content: result });
                            else setSopPreview({ name: sop.name, content: result.content ?? JSON.stringify(result) });
                          });
                      }}
                    >
                      查看
                    </button>
                  )}
                </div>
              ))}
              {sopPreview && (
                <pre className="muted" style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>
                  {`# ${sopPreview.name}\n${sopPreview.content}`}
                </pre>
              )}
              <p className="muted">安装器只接收声明式 Agent Skill 包并逐次验哈希；不会运行 npm install、生命周期钩子或任意 Pi TypeScript extension。SOP 写入仍只走蒸馏审计。</p>
              {integrationNotice && <p className="muted">{integrationNotice}</p>}
            </section>
          )}

          {tab === "runtime" && (
          <>
          <section className="info-card">
            <h3>应用更新</h3>
            <div className="ability-row">
              <span className="ability-dot ok" />
              <strong>当前版本</strong>
              <small>{handshake?.productVersion ?? "0.4.0"}</small>
            </div>
            {update?.has_update ? (
              <div className="update-available">
                <div className="ability-row">
                  <span className="ability-dot update" />
                  <strong>新版本 {update.version} 已准备好</strong>
                </div>
                {update.body && <p className="muted">{update.body}</p>}
                <p className="muted">
                  签名包下载校验后自动备份数据库并重启——更新留痕在数据目录 update-journal.json。
                </p>
                <button className="primary-button" disabled={installingUpdate} onClick={onInstallUpdate}>
                  {installingUpdate ? "正在下载/校验/安装…" : "安全更新并重启"}
                </button>
              </div>
            ) : (
              <div className="wizard-reentry">
                <button className="secondary-button" disabled={updateChecking} onClick={onCheckUpdate}>
                  <Icon name="refresh" size={14} />
                  {updateChecking ? "正在检查…" : "检查更新"}
                </button>
                {update && !update.has_update && !updateChecking && (
                  <span className="muted update-ok">已是最新</span>
                )}
              </div>
            )}
            {updateError && <p className="wizard-warn">⚠ {updateError}</p>}
            <p className="muted">
              更新通道：GitHub Releases（minisign 签名校验，验不过不安装）；托盘菜单亦可检查。
            </p>
          </section>

          <section className="info-card">
            <h3>运行时</h3>
            <dl>
              <div><dt>产品版本</dt><dd>{handshake?.productVersion ?? "0.4.0"}</dd></div>
              <div><dt>Host 版本</dt><dd>{handshake?.runtimeVersion ?? "—"}</dd></div>
              <div><dt>协议</dt><dd>v{handshake?.protocolSchemaVersion ?? 1}</dd></div>
              <div><dt>数据库</dt><dd>v{handshake?.databaseSchemaVersion ?? "—"}</dd></div>
              <div><dt>实例</dt><dd>{handshake?.instanceId.slice(0, 8) ?? "—"}</dd></div>
              {homeDir && <div><dt>数据目录</dt><dd>{homeDir}</dd></div>}
            </dl>
          </section>
          </>
          )}
        </div>
      </section>
    </main>
  );
}
