/**
 * Single conversation surface (ZCode-like):
 * - no project → normal chat
 * - with project → same chat in that folder with full Pi tools
 * No separate "work mode" / "start run" ritual for day-to-day use.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ContextReference, Project } from "@penglai/protocol";
import type { ConversationStream } from "../hooks/useConversationStream.js";
import type { PenglaiBridge, SubscriptionState } from "../bridge/types.js";
import { streamItems, toolSummary, type StreamItem } from "../state/conversation.js";
import { clockLabel } from "../state/format.js";
import { Icon } from "./Icon.js";
import { MarkdownMessage } from "./MarkdownMessage.js";

export function ContextSourceCards({
  refs,
  bridge,
}: {
  refs: ContextReference[];
  bridge?: PenglaiBridge | null;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);
  if (refs.length === 0) return null;
  return (
    <div className="context-source-cards" aria-label="来源卡片">
      {refs.map((ref) => {
        const statusLabel =
          ref.status === "current"
            ? "当前"
            : ref.status === "stale"
              ? "来源已更新"
              : ref.status === "revoked"
                ? "已撤销"
                : "不可用";
        const canOpen = ref.status === "current" || ref.status === "stale";
        return (
          <button
            key={ref.ref}
            type="button"
            className={`context-source-card status-${ref.status}`}
            disabled={!bridge || !canOpen || busyRef === ref.ref}
            title={
              ref.status === "revoked"
                ? "来源授权已移除，无法打开正文"
                : ref.status === "stale"
                  ? "来源已更新；点击通过 Host 按 ref 安全读取"
                  : "点击通过 Host 按 ref 安全读取（不提交路径）"
            }
            onClick={() => {
              if (!bridge || !canOpen) return;
              void (async () => {
                setBusyRef(ref.ref);
                setNotice(null);
                try {
                  // R4: renderer only submits opaque ref — Host resolves safely.
                  const result = await bridge.rpc<{
                    status?: string;
                    stale?: boolean;
                    text?: string;
                    relativePath?: string;
                  }>("context.read", { contextRef: ref.ref, maxChars: 2_000 });
                  const status = result.status ?? (result.stale ? "stale" : "current");
                  if (status === "revoked") {
                    setNotice(`[${ref.ordinal}] 来源已撤销，不返回正文`);
                    return;
                  }
                  const preview = (result.text ?? "").replace(/\s+/g, " ").slice(0, 180);
                  setNotice(
                    `[${ref.ordinal}] ${result.relativePath ?? ref.relativePath}` +
                      (status === "stale" ? " · 来源已更新" : "") +
                      (preview ? ` — ${preview}` : ""),
                  );
                } catch (error) {
                  setNotice(`打开来源失败：${String(error)}`);
                } finally {
                  setBusyRef(null);
                }
              })();
            }}
          >
            <span className="context-source-ordinal">[{ref.ordinal}]</span>
            <span className="context-source-title">{ref.title || ref.relativePath}</span>
            <span className="context-source-path">{ref.relativePath}</span>
            {ref.location?.headingPath ? (
              <span className="context-source-loc">{ref.location.headingPath}</span>
            ) : null}
            <span className={`context-source-status status-${ref.status}`}>{statusLabel}</span>
          </button>
        );
      })}
      {notice && <p className="muted context-source-notice">{notice}</p>}
    </div>
  );
}

/** W2: empty-conversation guide — add sources or click Host-generated example questions. */
export function ChatEmptyGuide({
  bridge,
  onAsk,
  onDismissAdd,
}: {
  bridge?: PenglaiBridge | null;
  onAsk: (question: string) => void;
  onDismissAdd?: () => void;
}) {
  const [suggestions, setSuggestions] = useState<
    Array<{ question: string; documentTitle: string; relativePath: string }>
  >([]);
  const [hasSources, setHasSources] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissedAdd, setDismissedAdd] = useState(false);

  useEffect(() => {
    if (!bridge) {
      setHasSources(false);
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const listed = await bridge.rpc<{ sources?: Array<{ id: string }> }>(
          "context.source.list",
          {},
        );
        const count = listed.sources?.length ?? 0;
        if (cancelled) return;
        setHasSources(count > 0);
        if (count === 0) {
          setSuggestions([]);
          return;
        }
        const result = await bridge.rpc<{
          suggestions?: Array<{
            question: string;
            documentTitle: string;
            relativePath: string;
          }>;
        }>("context.suggestions", { globalOnly: true, limit: 3 });
        if (!cancelled) setSuggestions(result.suggestions ?? []);
      } catch {
        if (!cancelled) {
          setHasSources(false);
          setSuggestions([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const addSource = async (): Promise<void> => {
    if (!bridge) return;
    setBusy(true);
    setNotice(null);
    try {
      const isTauri =
        typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
      if (!isTauri) {
        setNotice("需要在桌面应用中添加资料目录；也可使用 CLI。");
        return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{
        cancelled?: boolean;
        source?: { id: string; successCount: number; failureCount: number };
      }>("context_register_source", { scope: "global", projectId: null });
      if (result?.cancelled) {
        setNotice("已取消选择目录");
        return;
      }
      if (!result?.source) {
        setNotice("注册未返回结果");
        return;
      }
      setHasSources(true);
      setNotice(
        `已索引 · 成功 ${result.source.successCount} · 失败 ${result.source.failureCount}`,
      );
      const sug = await bridge.rpc<{
        suggestions?: Array<{
          question: string;
          documentTitle: string;
          relativePath: string;
        }>;
      }>("context.suggestions", { globalOnly: true, limit: 3 });
      setSuggestions(sug.suggestions ?? []);
    } catch (error) {
      setNotice(`添加失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  if (hasSources === null) {
    return (
      <div className="new-task-intro">
        <div className="brand-seal intro">蓬</div>
        <h2>从一句话开始</h2>
        <p className="muted">正在确认个人上下文…</p>
      </div>
    );
  }

  if (!hasSources && !dismissedAdd) {
    return (
      <div className="new-task-intro" data-testid="chat-empty-add-source">
        <div className="brand-seal intro">蓬</div>
        <h2>让它先读懂你的工作资料</h2>
        <p>
          添加一个本地文档目录后，对话会自动检索并带来源卡片。索引只在本机，不上传；随时可移除。
        </p>
        <div className="wizard-actions center">
          <button
            type="button"
            className="primary-button"
            disabled={busy || !bridge}
            onClick={() => void addSource()}
          >
            {busy ? "正在索引…" : "添加工作资料"}
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setDismissedAdd(true);
              onDismissAdd?.();
            }}
          >
            暂不
          </button>
        </div>
        {notice && <p className="muted">{notice}</p>}
      </div>
    );
  }

  if (suggestions.length > 0) {
    return (
      <div className="new-task-intro" data-testid="chat-empty-suggestions">
        <div className="brand-seal intro">蓬</div>
        <h2>试试问它这些</h2>
        <p>问题来自你已授权资料的真实标题（离线生成，不调用模型）。</p>
        <div className="chat-suggestion-list">
          {suggestions.map((item) => (
            <button
              key={`${item.relativePath}:${item.question}`}
              type="button"
              className="secondary-button chat-suggestion-button"
              onClick={() => onAsk(item.question)}
            >
              {item.question}
            </button>
          ))}
        </div>
        {notice && <p className="muted">{notice}</p>}
      </div>
    );
  }

  return (
    <div className="new-task-intro">
      <div className="brand-seal intro">蓬</div>
      <h2>从一句话开始</h2>
      <p>
        一个对话，完整工具。建议开聊前用输入框「选择项目」绑定工作区（绑定后本会话不再中途换项目）。
        直接说需求即可。
      </p>
      {notice && <p className="muted">{notice}</p>}
    </div>
  );
}

export type ConversationApprovalCard = {
  id: string;
  conversationId: string;
  toolName: string;
  capability: string;
  action: string;
  reason: string;
  level: "L2" | "L3";
  argsExcerpt?: string;
  status: string;
  createdAt: number;
};

function subStateChip(subState: SubscriptionState | null) {
  if (subState === "reconnecting") {
    return <span className="conn-chip reconnecting">重连中…</span>;
  }
  if (subState === "closed") {
    return <span className="conn-chip closed">事件通道已断开</span>;
  }
  return null;
}

function ThinkingBlock({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <details className="thinking-block">
      <summary>思考过程</summary>
      <pre>{text}</pre>
    </details>
  );
}

async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function StreamEntry({
  item,
  onOpenTask,
  onExitWork,
  onSpeak,
  bridge,
}: {
  item: StreamItem;
  onOpenTask: (taskId: string) => void;
  onExitWork: () => void;
  onSpeak?: (text: string) => void;
  bridge?: PenglaiBridge | null;
}) {
  if (item.kind === "message") {
    const images = item.images ?? [];
    if (item.role === "user") {
      return (
        <article className="user-message">
          {images.length > 0 && (
            <div className="message-images">
              {images.map((img, index) => (
                <img
                  key={`${item.id}-img-${index}`}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={img.name || "附件图片"}
                  className="message-image-thumb"
                />
              ))}
            </div>
          )}
          {item.text ? <p>{item.text}</p> : null}
          <time>{clockLabel(item.at)}</time>
        </article>
      );
    }
    return (
      <article className="agent-message">
        <div className="agent-avatar">蓬</div>
        <div className="agent-body">
          <div className="agent-meta">
            <strong>蓬莱</strong>
            <span>{clockLabel(item.at)}</span>
            {item.text && onSpeak && (
              <button
                type="button"
                className="composer-icon-btn ghost"
                aria-label="用 MOSS-TTS 朗读"
                title="用本地 MOSS-TTS 朗读"
                onClick={() => onSpeak(item.text)}
              >
                🔊
              </button>
            )}
          </div>
          {images.length > 0 && (
            <div className="message-images">
              {images.map((img, index) => (
                <img
                  key={`${item.id}-img-${index}`}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={img.name || "附件图片"}
                  className="message-image-thumb"
                />
              ))}
            </div>
          )}
          {item.text ? <MarkdownMessage text={item.text} /> : null}
          {item.role === "assistant" && item.contextReferences?.length ? (
            <ContextSourceCards refs={item.contextReferences} bridge={bridge} />
          ) : null}
        </div>
      </article>
    );
  }
  if (item.kind === "thinking") {
    return <ThinkingBlock text={item.text} />;
  }
  if (item.kind === "streaming") {
    const summary = toolSummary(item.tools);
    return (
      <article className="agent-message streaming">
        <div className="agent-avatar">蓬</div>
        <div className="agent-body">
          <div className="agent-meta">
            <strong>蓬莱</strong>
            <span>正在回复…</span>
          </div>
          <ThinkingBlock text={item.thinking} />
          <MarkdownMessage text={item.text || "…"} streaming />
          {item.tools.length > 0 && (
            <ul className="tool-activity">
              {item.tools.map((tool, index) => (
                <li key={tool.toolCallId ?? index} className={tool.ok === false ? "failed" : ""}>
                  {tool.ok === null ? (
                    <span className="mini-spinner" />
                  ) : tool.ok ? (
                    <Icon name="check" size={12} />
                  ) : (
                    <Icon name="x" size={12} />
                  )}
                  <span>{tool.toolName}</span>
                </li>
              ))}
            </ul>
          )}
          {summary.failed > 0 && (
            <small className="tool-failed-note">{summary.failed} 个工具调用失败</small>
          )}
        </div>
      </article>
    );
  }
  if (item.kind === "mode") {
    return (
      <div className="mode-card">
        <div className="mode-card-head">
          <Icon name="folder" size={16} />
          <strong>已进入项目「{item.project.name}」</strong>
          <span className="mode-chip work">工作区</span>
        </div>
        <p>
          已绑定该文件夹为工作区。本对话内完整读写/命令可用；外发等高风险由审批策略处理，不必再点「开始执行」。
        </p>
        <div className="mode-card-actions">
          <button className="secondary-button" onClick={onExitWork}>
            离开项目
          </button>
        </div>
      </div>
    );
  }
  return <div className={`stream-notice ${item.tone}`}>{item.text}</div>;
}

export function ChatPanel({
  conversationId,
  title,
  stream,
  projects,
  onSend,
  onPickFolder,
  onPickFile,
  onEnsureConversation,
  onProjectsChanged,
  onOpenTask,
  onNewChat,
  onCompleteFiles,
  profiles = [],
  activeProfileId = null,
  onProfileChange,
  usageLabel = null,
  pendingApprovals = 0,
  trustedProject = null,
  activeProject = null,
  bridge = null,
  onConversationApprovalDecided,
  goal: goalProp = null,
  contextPins = [],
  onMetaChanged,
  recentConversations = [],
  workbenchOpen = false,
  onToggleWorkbench,
  evidenceOpen = false,
  evidenceAvailable = false,
  onToggleEvidence,
  onOpenDoctor,
  askAppPrompt,
  sops = [],
  asrReady = false,
  ttsReady = false,
  onTranscribeVoice,
  onSpeakText,
}: {
  conversationId: string | null;
  title: string | null;
  stream: ConversationStream;
  projects: Project[];
  onSend: (
    text: string,
    options?: {
      delivery?: "queue" | "now";
      permissionMode?: "confirm" | "auto_edit" | "full" | "plan";
      thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
      images?: Array<{ data: string; mimeType: string; name?: string }>;
    },
  ) => void;
  onPickFolder: () => Promise<string | null>;
  /** Owner file picker; Host copies the selected file into the conversation inbox. */
  onPickFile?: () => Promise<string | null>;
  /** Create/select a conversation before anchoring a project (required when conversationId is null). */
  onEnsureConversation?: () => Promise<string | null>;
  /** Refresh sidebar project/task tree after enter. */
  onProjectsChanged?: () => void;
  onOpenTask: (taskId: string) => void;
  /** Clear selection to start a fresh conversation. */
  onNewChat?: () => void;
  /** Host files.complete for @ mentions. */
  onCompleteFiles?: (query: string) => Promise<Array<{ path: string; name: string; isDir: boolean }>>;
  profiles?: Array<{ id: string; label: string; model: string; vision?: boolean }>;
  activeProfileId?: string | null;
  onProfileChange?: (profileId: string) => void;
  /** Honest coarse context/usage label from Host (e.g. "今日 2.3k · 窗口 128k"). */
  usageLabel?: string | null;
  pendingApprovals?: number;
  /** When work-anchored, whether the project is trusted (Host truth). */
  trustedProject?: boolean | null;
  /** Bound project for header / composer (ZCode workspace chip). */
  activeProject?: Project | null;
  bridge?: PenglaiBridge | null;
  onConversationApprovalDecided?: () => void;
  /** Active goal from conversation meta (Host truth). */
  goal?: string | null;
  contextPins?: Array<{ id: string; kind: string; label: string; ref: string }>;
  /** After goal/pin/compact mutations, parent reloads conversation list. */
  onMetaChanged?: () => void;
  /** Other conversations for #session pin (ZCode # 关联对话). */
  recentConversations?: Array<{ id: string; title: string }>;
  workbenchOpen?: boolean;
  onToggleWorkbench?: () => void;
  /** Current anchored task evidence rail, still inside the single conversation surface. */
  evidenceOpen?: boolean;
  evidenceAvailable?: boolean;
  onToggleEvidence?: () => void;
  onOpenDoctor?: () => void;
  /** In-app prompt (never window.prompt). */
  askAppPrompt?: (options: {
    title: string;
    message?: string;
    initial?: string;
    placeholder?: string;
    multiline?: boolean;
  }) => Promise<string | null>;
  sops?: Array<{ name: string; title: string }>;
  asrReady?: boolean;
  ttsReady?: boolean;
  onTranscribeVoice?: (input: { audioBase64: string; format: string }) => Promise<{
    ok: boolean;
    text?: string;
    emotion?: string;
    language?: string;
    error?: string;
  }>;
  onSpeakText?: (text: string) => void;
}) {
  const appPrompt = async (options: {
    title: string;
    message?: string;
    initial?: string;
    placeholder?: string;
    multiline?: boolean;
  }): Promise<string | null> => {
    if (askAppPrompt) return askAppPrompt(options);
    return null;
  };

  const [composer, setComposer] = useState("");
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [pendingImages, setPendingImages] = useState<
    Array<{ id: string; mimeType: string; data: string; name: string; previewUrl: string }>
  >([]);
  const [permissionMode, setPermissionMode] = useState<"confirm" | "auto_edit" | "full" | "plan">("auto_edit");
  const [thinkingLevel, setThinkingLevel] = useState<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max">("medium");
  const [queuedHint, setQueuedHint] = useState(false);
  const [convApprovals, setConvApprovals] = useState<ConversationApprovalCard[]>([]);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const [localGoal, setLocalGoal] = useState<string | null>(goalProp ?? null);
  const [localPins, setLocalPins] = useState(contextPins);
  const [compactBusy, setCompactBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  useEffect(() => {
    setLocalGoal(goalProp ?? null);
  }, [goalProp, conversationId]);
  useEffect(() => {
    setLocalPins(contextPins);
  }, [contextPins, conversationId]);
  // Goal-oriented: prefer plan dial when a goal is present and dial still default.
  useEffect(() => {
    if (localGoal?.trim()) {
      setPermissionMode((prev) => (prev === "auto_edit" ? "plan" : prev));
    }
  }, [localGoal]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [atOpen, setAtOpen] = useState(false);
  const [atHits, setAtHits] = useState<Array<{ path: string; name: string; isDir: boolean }>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => streamItems(stream.state), [stream.state]);
  // SSOT: activeTaskId (mode is legacy mirror).
  const inWork = Boolean(stream.state.activeTaskId) || stream.state.mode === "work";

  const toggleRecording = async (): Promise<void> => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!asrReady || !onTranscribeVoice) {
      setActionNotice("SenseVoice ASR 尚未就绪；请先到「能力」下载本地模型。");
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        setRecording(false);
        for (const track of media.getTracks()) track.stop();
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        void (async () => {
          try {
            const format = blob.type.includes("mp4") ? "m4a" : blob.type.includes("wav") ? "wav" : "webm";
            const result = await onTranscribeVoice({ audioBase64: await blobBase64(blob), format });
            if (!result.ok || !result.text) {
              setActionNotice(result.error ?? "没有识别到语音，请重试。");
              return;
            }
            const tags = [result.emotion && result.emotion !== "NEUTRAL" ? result.emotion : null, result.language]
              .filter(Boolean)
              .join(" · ");
            setComposer(`[语音${tags ? ` · ${tags}` : ""}] ${result.text}`);
            setActionNotice("本地 SenseVoice 已转写；确认文字后发送。");
          } catch (error) {
            setActionNotice(`语音转写失败：${String(error)}`);
          }
        })();
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setActionNotice("正在录音…再次点击麦克风结束。");
    } catch (error) {
      setActionNotice(`无法使用麦克风：${String(error)}`);
    }
  };

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    for (const track of recorder?.stream.getTracks() ?? []) track.stop();
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [items.length, stream.state.streamingText, stream.state.streaming]);

  // Conversation-path L2/L3 approval cards (permission dial confirm/auto_edit).
  useEffect(() => {
    if (!bridge || !conversationId) {
      setConvApprovals([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      void bridge
        .rpc<ConversationApprovalCard[]>("conversation.approval.list", {
          conversationId,
          status: "pending",
        })
        .then((rows) => {
          if (!cancelled) setConvApprovals(Array.isArray(rows) ? rows : []);
        })
        .catch(() => {
          if (!cancelled) setConvApprovals([]);
        });
    };
    load();
    let stop: (() => void) | undefined;
    void bridge
      .subscribe(conversationId, (event) => {
        const kind = typeof event.event === "string" ? event.event : "";
        if (
          kind === "conversation.approval.requested" ||
          kind === "conversation.approval.approved" ||
          kind === "conversation.approval.denied"
        ) {
          load();
        }
      })
      .then((unsub) => {
        stop = unsub;
      })
      .catch(() => undefined);
    const timer = setInterval(load, 4_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      stop?.();
    };
  }, [bridge, conversationId]);

  const decideConvApproval = async (
    id: string,
    verdict: "approve" | "reject",
    opts?: { rememberSession?: boolean },
  ) => {
    if (!bridge) return;
    setDecidingId(id);
    try {
      await bridge.rpc(
        verdict === "approve"
          ? "conversation.approval.approve"
          : "conversation.approval.reject",
        {
          approvalId: id,
          decidedBy: "desktop:owner",
          rememberSession: opts?.rememberSession === true,
        },
      );
      setConvApprovals((rows) => rows.filter((r) => r.id !== id));
      onConversationApprovalDecided?.();
    } catch {
      /* host surfaces via next list */
    } finally {
      setDecidingId(null);
    }
  };

  const ensureId = async (): Promise<string | null> => {
    if (conversationId) return conversationId;
    return (await onEnsureConversation?.()) ?? null;
  };

  const setGoal = async (text: string | null) => {
    const id = await ensureId();
    if (!id || !bridge) {
      setActionNotice("需要先有会话并连上 Host 才能设定目标");
      return;
    }
    try {
      if (text === null || !text.trim()) {
        const result = await bridge.rpc<{ conversation: { goal?: string | null } }>(
          "conversation.goal.clear",
          { conversationId: id },
        );
        setLocalGoal(result.conversation?.goal ?? null);
        setActionNotice("已清除目标");
      } else {
        const result = await bridge.rpc<{
          conversation: { goal?: string | null };
          kick?: { text?: string } | null;
        }>("conversation.goal.set", {
          conversationId: id,
          goal: text.trim(),
          // ZCode session/goal starts a turn; kick plan orientation here too.
          kick: true,
        });
        setLocalGoal(result.conversation?.goal ?? text.trim());
        setPermissionMode("plan");
        setActionNotice(
          result.kick?.text
            ? "目标已设定 · 已启动计划回合 · 权限=目标/计划"
            : "目标已设定 · 权限拨到「目标/计划」",
        );
      }
      onMetaChanged?.();
    } catch (error) {
      setActionNotice(`目标失败：${String(error)}`);
    }
  };

  const runCompact = async (instructions?: string) => {
    const id = await ensureId();
    if (!id || !bridge) {
      setActionNotice("需要先有会话才能压缩");
      return;
    }
    setCompactBusy(true);
    try {
      const result = await bridge.rpc<{
        ok: boolean;
        deferred?: boolean;
        note?: string;
        detail?: string | null;
      }>("conversation.compact", {
        conversationId: id,
        instructions: instructions || undefined,
      });
      if (result.ok && !result.deferred) {
        setActionNotice(result.detail || "已压缩会话上下文");
      } else if (result.deferred) {
        setActionNotice(result.note || result.detail || "压缩已推迟");
      } else {
        setActionNotice(result.detail || result.note || "压缩失败");
      }
    } catch (error) {
      setActionNotice(`压缩失败：${String(error)}`);
    } finally {
      setCompactBusy(false);
    }
  };

  const addPin = async (
    kind: "file" | "skill" | "note" | "mcp" | "url" | "session",
    ref: string,
    label?: string,
  ) => {
    const id = await ensureId();
    if (!id || !bridge || !ref.trim()) return;
    try {
      const result = await bridge.rpc<{
        conversation: { contextPins?: Array<{ id: string; kind: string; label: string; ref: string }> };
      }>("conversation.pin.add", {
        conversationId: id,
        kind,
        ref: ref.trim(),
        label: label?.trim() || undefined,
      });
      setLocalPins(result.conversation?.contextPins ?? []);
      setActionNotice(`已钉入上下文：${label || ref}`);
      onMetaChanged?.();
    } catch (error) {
      setActionNotice(`钉入失败：${String(error)}`);
    }
  };

  const removePin = async (pinId: string) => {
    const id = await ensureId();
    if (!id || !bridge) return;
    try {
      const result = await bridge.rpc<{
        conversation: { contextPins?: Array<{ id: string; kind: string; label: string; ref: string }> };
      }>("conversation.pin.remove", { conversationId: id, pinId });
      setLocalPins(result.conversation?.contextPins ?? []);
      onMetaChanged?.();
    } catch (error) {
      setActionNotice(`取消钉入失败：${String(error)}`);
    }
  };

  const runSlash = (cmd: string, argText = "") => {
    setSlashOpen(false);
    setPlusOpen(false);
    setComposer("");
    if (cmd === "/new") {
      onNewChat?.();
      return;
    }
    if (cmd === "/mode" || cmd === "/project") {
      setWorkspaceMenuOpen(true);
      setPlusOpen(false);
      return;
    }
    if (cmd === "/stop") {
      void stream.abort();
      return;
    }
    if (cmd === "/compact") {
      void runCompact(argText || undefined);
      return;
    }
    if (cmd === "/goal") {
      if (!argText.trim() || argText.trim() === "clear") {
        if (argText.trim() === "clear") void setGoal(null);
        else if (localGoal) {
          setActionNotice(`当前目标：${localGoal}`);
        } else {
          setComposer("/goal ");
          setActionNotice("输入 /goal <目标> 设定 · /goal clear 清除");
        }
        return;
      }
      void setGoal(argText.trim());
      return;
    }
    if (cmd === "/pin") {
      const parts = argText.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        setComposer("/pin file ");
        setActionNotice("/pin file 路径 · /pin skill 名 · /pin session 会话id · /pin note 文本");
        return;
      }
      const kinds = new Set(["file", "skill", "note", "mcp", "url", "session"]);
      let kind: "file" | "skill" | "note" | "mcp" | "url" | "session" = "note";
      let idx = 0;
      if (kinds.has(parts[0] ?? "")) {
        kind = parts[0] as typeof kind;
        idx = 1;
      } else if ((parts[0] ?? "").startsWith("conv_")) {
        kind = "session";
      } else if ((parts[0] ?? "").startsWith("/") || (parts[0] ?? "").startsWith("@")) {
        kind = "file";
      }
      const ref = (parts[idx] ?? "").replace(/^@/, "").replace(/^#/, "");
      const label = parts.slice(idx + 1).join(" ") || undefined;
      if (!ref) {
        setActionNotice("缺少钉入引用");
        return;
      }
      void addPin(kind, ref, label);
      return;
    }
    if (cmd === "/help") {
      setComposer(
        "可用：/new · /project · /goal · /compact · /pin · /stop · /help · @文件 · +菜单钉入",
      );
      return;
    }
  };

  const refreshAt = (value: string) => {
    const match = /(^|\s)@([^\s@]*)$/.exec(value);
    if (!match || !onCompleteFiles) {
      setAtOpen(false);
      setAtHits([]);
      return;
    }
    const query = match[2] ?? "";
    void onCompleteFiles(query).then((hits) => {
      setAtHits(hits);
      setAtOpen(hits.length > 0);
    });
  };

  const insertAt = (hit: { path: string }) => {
    const next = composer.replace(/(^|\s)@([^\s@]*)$/, `$1@${hit.path} `);
    setComposer(next);
    setAtOpen(false);
    setAtHits([]);
  };

  const fileToPendingImage = (file: File): Promise<{
    id: string;
    mimeType: string;
    data: string;
    name: string;
    previewUrl: string;
  } | null> =>
    new Promise((resolve) => {
      const mime = (file.type || "").toLowerCase();
      if (!/^image\/(png|jpe?g|gif|webp)$/.test(mime)) {
        resolve(null);
        return;
      }
      if (file.size > 4 * 1024 * 1024) {
        setActionNotice("图片超过 4MB，已跳过");
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const match = /^data:([^;]+);base64,(.+)$/.exec(result);
        if (!match) {
          resolve(null);
          return;
        }
        resolve({
          id: `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          mimeType: match[1] === "image/jpg" ? "image/jpeg" : match[1],
          data: match[2],
          name: file.name || "paste.png",
          previewUrl: result,
        });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });

  const addPendingImages = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const next: Array<{
      id: string;
      mimeType: string;
      data: string;
      name: string;
      previewUrl: string;
    }> = [];
    for (const file of list) {
      const img = await fileToPendingImage(file);
      if (img) next.push(img);
    }
    if (next.length === 0) return;
    setPendingImages((prev) => [...prev, ...next].slice(0, 4));
  };

  const importPickedFile = async () => {
    if (!onPickFile || !bridge) return;
    const sourcePath = await onPickFile();
    if (!sourcePath) return;
    const id = await ensureId();
    if (!id) return;
    try {
      const imported = await bridge.rpc<{ relativePath: string; name: string; bytes: number; sha256: string }>(
        "conversation.attachment.import",
        { conversationId: id, sourcePath },
      );
      setComposer((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${imported.relativePath} `);
      setActionNotice(`已导入 ${imported.name} · ${imported.bytes} bytes · ${imported.sha256.slice(0, 10)}`);
    } catch (error) {
      setActionNotice(`文件导入失败：${String(error)}`);
    }
  };

  // ZCode default: zcodeInteractionBehavior = queue.
  // Busy + Enter/send → auto followUp queue; never force the owner to pick 排队/立即.
  // Opt-in steer only via explicit "立即" (secondary, when busy).
  const submit = (delivery: "queue" | "now" = "queue") => {
    const text = composer.trim();
    const images = pendingImages.map((img) => ({
      data: img.data,
      mimeType: img.mimeType,
      name: img.name,
    }));
    if (!text && images.length === 0) return;
    if (images.length > 0) {
      const profile = profiles.find((p) => p.id === activeProfileId);
      if (profile && profile.vision === false) {
        setActionNotice(
          `当前模型「${profile.label || profile.model}」未标 vision，图会附上但可能无法理解 — 可换视觉模型`,
        );
      }
    }
    if (text.startsWith("/") && images.length === 0) {
      const parts = text.split(/\s+/);
      const cmd = parts[0]?.toLowerCase() ?? "";
      const argText = text.slice(parts[0].length).trim();
      const normalized =
        cmd === "/?" ? "/help" : cmd === "/project" ? "/mode" : cmd === "/goalclear" ? "/goal" : cmd;
      if (
        ["/new", "/mode", "/stop", "/help", "/compact", "/goal", "/pin"].includes(normalized)
      ) {
        setComposer("");
        if (normalized === "/goal" && argText === "clear") {
          runSlash("/goal", "clear");
        } else {
          runSlash(normalized, argText);
        }
        return;
      }
    }
    setComposer("");
    setPendingImages([]);
    setSlashOpen(false);
    setAtOpen(false);
    setPlusOpen(false);
    const episodeBusy = stream.busy || stream.state.streaming;
    // Default path is always queue (Pi followUp). "now" is explicit steer only.
    const resolved: "queue" | "now" = delivery === "now" ? "now" : "queue";
    if (episodeBusy && resolved === "queue") {
      setQueuedHint(true);
      setActionNotice("已排队 · 当前回复结束后自动发送");
    } else if (episodeBusy && resolved === "now") {
      setQueuedHint(false);
      setActionNotice("已立即插入当前回合");
    } else {
      setQueuedHint(false);
    }
    const expanded = text.replace(/\[\[skill:([A-Za-z0-9._-]+)\]\]/g, "/$1");
    onSend(expanded, {
      delivery: resolved,
      permissionMode,
      thinkingLevel,
      images: images.length > 0 ? images : undefined,
    });
  };

  // Clear queue hint when the episode goes idle again.
  useEffect(() => {
    if (!(stream.busy || stream.state.streaming) && queuedHint) {
      setQueuedHint(false);
      setActionNotice((prev) =>
        prev && prev.includes("排队") ? null : prev,
      );
    }
  }, [stream.busy, stream.state.streaming, queuedHint]);

  const filteredProjects = useMemo(() => {
    const q = workspaceQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.rootPath.toLowerCase().includes(q),
    );
  }, [projects, workspaceQuery]);

  /**
   * ZCode-like: workspace is chosen for this conversation (ideally at start).
   * Once anchored, do NOT switch projects mid-thread — open a new chat instead.
   */
  const enterProject = async (opts?: { projectId?: string; rootPath?: string }) => {
    const projectId = opts?.projectId;
    const rootPath = opts?.rootPath;
    if (!projectId && !rootPath) return;
    if (inWork) {
      setWorkspaceMenuOpen(false);
      setActionNotice("本会话已绑定工作区，不能中途换项目 — 请开新对话");
      return;
    }
    // Create conversation first when still on the empty surface.
    let readyId = conversationId;
    if (!readyId) {
      readyId = (await onEnsureConversation?.()) ?? null;
      if (!readyId) return;
    }
    setWorkspaceMenuOpen(false);
    setWorkspaceQuery("");
    const result = await stream.proposeWork({
      projectId,
      rootPath,
      objective: "",
      conversationId: readyId,
    });
    if (result) {
      setActionNotice(`工作区 · ${result.project.name}`);
      onProjectsChanged?.();
      onMetaChanged?.();
    }
  };

  const leaveProject = async () => {
    setWorkspaceMenuOpen(false);
    if (!inWork) return;
    // Leaving project is allowed (float again) but re-binding mid-thread is not.
    await stream.exitWork("paused");
    setActionNotice("已离开项目 · 新绑定请开新对话更干净");
    onProjectsChanged?.();
    onMetaChanged?.();
  };

  return (
    <main className="task-surface">
      <header className="task-header">
        <div>
          <p>
            {inWork
              ? activeProject
                ? `工作区 · ${activeProject.name}`
                : "项目工作区 · 完整 Pi 工具"
              : "对话 · 未选项目文件夹"}
          </p>
          <h1>{title ?? "今天想聊点什么？"}</h1>
          {inWork && activeProject && (
            <small className="workspace-path" title={activeProject.rootPath}>
              {activeProject.rootPath}
            </small>
          )}
        </div>
        <div className="task-header-actions">
          <span className={`mode-chip large ${inWork ? "work" : "chat"}`}>
            {inWork ? (activeProject ? activeProject.name : "有工作区") : "无工作区"}
          </span>
          {subStateChip(stream.subState)}
          <button
            type="button"
            className={workbenchOpen ? "secondary-button active" : "secondary-button"}
            disabled={!conversationId}
            onClick={() => onToggleWorkbench?.()}
            title="会话待办"
          >
            待办
          </button>
          <button
            type="button"
            className={evidenceOpen ? "secondary-button active" : "secondary-button"}
            disabled={!evidenceAvailable}
            onClick={() => onToggleEvidence?.()}
            title="当前项目任务的真实执行证据"
          >
            证据
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => onOpenDoctor?.()}
            title="环境自检 Doctor"
          >
            Doctor
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={compactBusy || !conversationId}
            onClick={() => void runCompact()}
            title="显式压缩会话上下文（Pi compact）"
          >
            {compactBusy ? "压缩中…" : "显式压缩"}
          </button>
          {inWork && (
            <button
              className="secondary-button"
              onClick={() => void stream.exitWork("paused")}
              title="离开项目，回到无工作区对话"
            >
              离开项目
            </button>
          )}
        </div>
      </header>

      {(localGoal?.trim() || localPins.length > 0) && (
        <div className="goal-pin-bar" role="status">
          {localGoal?.trim() && (
            <div className="goal-chip" title={localGoal}>
              <span className="goal-chip-label">🎯 目标</span>
              <span className="goal-chip-text">{localGoal}</span>
              <button
                type="button"
                className="link-button"
                onClick={() => void setGoal(null)}
                title="清除目标"
              >
                清除
              </button>
            </div>
          )}
          {localPins.map((pin) => (
            <div className="pin-chip" key={pin.id} title={`${pin.kind}: ${pin.ref}`}>
              <span>
                📌 [{pin.kind}] {pin.label}
              </span>
              <button
                type="button"
                className="link-button"
                onClick={() => void removePin(pin.id)}
                title="取消钉入"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <section className="task-content" ref={scrollRef}>
        <div className="conversation">
          {convApprovals.length > 0 && (
            <div className="conversation-approvals">
              {convApprovals.map((approval) => (
                <section className="info-card approval-card" key={approval.id}>
                  <div className="approval-head">
                    <Icon name="seal" size={15} />
                    <strong>{approval.action}</strong>
                    <span className={`level-chip ${approval.level === "L2" ? "l2" : "l3"}`}>
                      {approval.level}
                    </span>
                  </div>
                  <p>{approval.reason}</p>
                  <dl>
                    <div>
                      <dt>工具</dt>
                      <dd>{approval.toolName}</dd>
                    </div>
                    <div>
                      <dt>能力</dt>
                      <dd>{approval.capability}</dd>
                    </div>
                    {approval.argsExcerpt && (
                      <div>
                        <dt>参数</dt>
                        <dd>
                          <code style={{ wordBreak: "break-all" }}>{approval.argsExcerpt}</code>
                        </dd>
                      </div>
                    )}
                  </dl>
                  <div className="approval-actions">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={decidingId === approval.id}
                      onClick={() => void decideConvApproval(approval.id, "approve")}
                    >
                      <Icon name="check" size={14} />允许一次
                    </button>
                    {approval.level === "L2" && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={decidingId === approval.id}
                        onClick={() =>
                          void decideConvApproval(approval.id, "approve", {
                            rememberSession: true,
                          })
                        }
                        title="本会话内同类操作不再询问（L2）"
                      >
                        本会话允许
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary-button danger"
                      disabled={decidingId === approval.id}
                      onClick={() => void decideConvApproval(approval.id, "reject")}
                    >
                      <Icon name="x" size={14} />拒绝
                    </button>
                  </div>
                </section>
              ))}
            </div>
          )}
          {items.length === 0 && (
            <ChatEmptyGuide
              bridge={bridge}
              onAsk={(question) => {
                onSend(question, {
                  delivery: "queue",
                  permissionMode,
                  thinkingLevel,
                });
              }}
            />
          )}
          {items.map((item, index) => (
            <StreamEntry
              key={item.kind === "message" ? item.id : `stream-${index}`}
              item={item}
              onOpenTask={onOpenTask}
              onExitWork={() => void stream.exitWork("paused")}
              onSpeak={ttsReady ? onSpeakText : undefined}
              bridge={bridge}
            />
          ))}
        </div>
      </section>

      <footer className="composer-wrap">
        {/* ZCode-like floating composer: one card, Enter always queues when busy. */}
        <div className={`composer zcode-composer${stream.busy || stream.state.streaming ? " is-busy" : ""}${queuedHint ? " has-queue" : ""}`}>
          {(queuedHint || (stream.busy && actionNotice?.includes("排队"))) && (
            <div className="composer-queue-banner" role="status">
              已排队 · 当前回复结束后自动发送
              <span className="queue-hint">
                · 按 <kbd>⌘Enter</kbd> 立即插入当前回合
              </span>
            </div>
          )}
          {pendingImages.length > 0 && (
            <div className="composer-image-previews">
              {pendingImages.map((img) => (
                <div className="composer-image-chip" key={img.id}>
                  <img src={img.previewUrl} alt={img.name} />
                  <button
                    type="button"
                    className="composer-image-remove"
                    title="移除图片"
                    onClick={() =>
                      setPendingImages((prev) => prev.filter((row) => row.id !== img.id))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="composer-context-row">
            <div className="workspace-chip-wrap">
              <button
                type="button"
                className={inWork || workspaceMenuOpen ? "composer-context-button active" : "composer-context-button"}
                onClick={() => {
                  setPlusOpen(false);
                  setSlashOpen(false);
                  setWorkspaceMenuOpen((open) => !open);
                }}
                title={
                  inWork
                    ? "本会话已绑定工作区（中途不可换项目）"
                    : "选择项目工作区（建议新对话时绑定）"
                }
              >
                <span className={`mode-dot ${inWork ? "work" : "chat"}`} />
                <span>{inWork ? activeProject?.name || "项目" : "选择项目"}</span>
                <span className="pill-caret">▾</span>
              </button>
              {workspaceMenuOpen && (
                <div className="workspace-menu" role="menu">
                  {!inWork && (
                    <>
                      <div className="workspace-menu-search">
                        <input
                          value={workspaceQuery}
                          onChange={(e) => setWorkspaceQuery(e.target.value)}
                          placeholder="搜索工作区"
                          autoFocus
                        />
                      </div>
                      <div className="workspace-menu-list">
                        {filteredProjects.length === 0 ? (
                          <p className="workspace-menu-empty">没有匹配的工作区</p>
                        ) : (
                          filteredProjects.map((project) => (
                            <button
                              key={project.id}
                              type="button"
                              className="workspace-menu-item"
                              role="menuitem"
                              onClick={() => void enterProject({ projectId: project.id })}
                            >
                              <span className="workspace-menu-name">{project.name}</span>
                              <small>{project.rootPath}</small>
                            </button>
                          ))
                        )}
                      </div>
                      <div className="workspace-menu-sep" />
                      <button
                        type="button"
                        className="workspace-menu-item"
                        onClick={() =>
                          void onPickFolder().then((rootPath) => {
                            if (rootPath) void enterProject({ rootPath });
                          })
                        }
                      >
                        打开文件夹…
                      </button>
                      <button
                        type="button"
                        className="workspace-menu-item muted"
                        onClick={() => setWorkspaceMenuOpen(false)}
                      >
                        不在项目中工作
                      </button>
                    </>
                  )}
                  {inWork && (
                    <>
                      <div className="workspace-menu-current">
                        <strong>{activeProject?.name || "项目"}</strong>
                        <small>{activeProject?.rootPath}</small>
                      </div>
                      <p className="workspace-menu-hint">
                        本会话工作区已固定，不能中途换项目。换目录请开新对话。
                      </p>
                      <button
                        type="button"
                        className="workspace-menu-item"
                        onClick={() => void leaveProject()}
                      >
                        离开项目（回助理目录）
                      </button>
                      <button
                        type="button"
                        className="workspace-menu-item"
                        onClick={() => {
                          setWorkspaceMenuOpen(false);
                          onNewChat?.();
                        }}
                      >
                        新对话（可另选项目）
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <textarea
            value={composer}
            onChange={(event) => {
              const value = event.target.value;
              setComposer(value);
              setSlashOpen(value === "/" || /^\/[a-z]*$/i.test(value));
              refreshAt(value);
            }}
            onPaste={(event) => {
              const items = event.clipboardData?.items;
              if (!items) return;
              const files: File[] = [];
              for (const item of Array.from(items)) {
                if (item.kind === "file" && item.type.startsWith("image/")) {
                  const file = item.getAsFile();
                  if (file) files.push(file);
                }
              }
              if (files.length === 0) return;
              event.preventDefault();
              void addPendingImages(files);
            }}
            onDrop={(event) => {
              const files = event.dataTransfer?.files;
              if (!files?.length) return;
              const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
              if (images.length === 0) return;
              event.preventDefault();
              void addPendingImages(images);
            }}
            onDragOver={(event) => {
              if (event.dataTransfer?.types?.includes("Files")) {
                event.preventDefault();
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSlashOpen(false);
                setAtOpen(false);
                setPlusOpen(false);
              }
              // ⌘/Ctrl+Enter = steer now when busy; plain Enter = queue (ZCode default).
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if ((event.metaKey || event.ctrlKey) && (stream.busy || stream.state.streaming)) {
                  submit("now");
                } else {
                  submit("queue");
                }
              }
            }}
            placeholder={
              stream.busy || stream.state.streaming
                ? "继续输入以排队后续修改 · 可粘贴图片"
                : inWork
                  ? "向蓬莱提问，使用 @ 添加上下文，使用 / 选择命令或能力"
                  : "向蓬莱提问，使用 @ 添加上下文，使用 / 选择命令或能力 · 可选项目"
            }
            rows={2}
          />
          {slashOpen && (
            <div className="slash-menu" role="listbox">
              {[
                { cmd: "/new", hint: "新对话" },
                { cmd: "/project", hint: inWork ? "查看工作区（不可中途换）" : "选择项目工作区" },
                { cmd: "/goal", hint: "设定/查看目标" },
                { cmd: "/compact", hint: "显式压缩上下文" },
                { cmd: "/pin", hint: "钉入文件/技能/笔记" },
                { cmd: "/stop", hint: "中断" },
                { cmd: "/help", hint: "帮助" },
              ].map((row) => (
                <button
                  key={row.cmd}
                  type="button"
                  className="slash-item"
                  onClick={() => {
                    if (row.cmd === "/goal" || row.cmd === "/pin") {
                      setSlashOpen(false);
                      setComposer(`${row.cmd} `);
                      return;
                    }
                    runSlash(row.cmd === "/project" ? "/mode" : row.cmd);
                  }}
                >
                  <code>{row.cmd}</code>
                  <span>{row.hint}</span>
                </button>
              ))}
              {sops.length > 0 && <div className="slash-menu-label">可用能力</div>}
              {sops.slice(0, 12).map((sop) => (
                <button
                  key={`skill:${sop.name}`}
                  type="button"
                  className="slash-item"
                  onClick={() => {
                    setSlashOpen(false);
                    setComposer((current) => {
                      const token = `[[skill:${sop.name}]] `;
                      return current.includes(token.trim()) ? current : token;
                    });
                  }}
                >
                  <code>/{sop.name}</code>
                  <span>{sop.title || "能力"}</span>
                </button>
              ))}
            </div>
          )}
          {atOpen && atHits.length > 0 && (
            <div className="slash-menu" role="listbox">
              {atHits.map((hit) => (
                <button
                  key={hit.path}
                  type="button"
                  className="slash-item"
                  onClick={() => insertAt(hit)}
                >
                  <code>@{hit.path}</code>
                  <span>{hit.isDir ? "目录" : "文件"}</span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={imageFileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={(event) => {
              const files = event.target.files;
              if (files?.length) void addPendingImages(files);
              event.target.value = "";
            }}
          />
          {plusOpen && (
            <div className="slash-menu plus-menu" role="menu">
              <button
                type="button"
                className="slash-item"
                onClick={() => {
                  setPlusOpen(false);
                  void importPickedFile();
                }}
              >
                <code>+ 文件</code>
                <span>导入 PDF / Word / Excel / PPT / 文本</span>
              </button>
              <button
                type="button"
                className="slash-item"
                onClick={() => {
                  setPlusOpen(false);
                  imageFileRef.current?.click();
                }}
              >
                <code>+ 图片</code>
                <span>选择/粘贴图片附件</span>
              </button>
              <button
                type="button"
                className="slash-item"
                onClick={() => {
                  setPlusOpen(false);
                  setComposer("@");
                  refreshAt("@");
                }}
              >
                <code>@文件</code>
                <span>插入路径引用</span>
              </button>
              <button
                type="button"
                className="slash-item"
                onClick={() => {
                  setPlusOpen(false);
                  void appPrompt({
                    title: "钉入文件",
                    message: "相对工作区或绝对路径",
                    placeholder: "src/index.ts",
                  }).then((pathHint) => {
                    if (pathHint?.trim()) void addPin("file", pathHint.trim());
                  });
                }}
              >
                <code>+ 钉入文件</code>
                <span>注入上下文</span>
              </button>
              <button
                type="button"
                className="slash-item"
                onClick={() => {
                  setPlusOpen(false);
                  void appPrompt({
                    title: "钉入备注",
                    message: "固定约束 / 笔记",
                    multiline: true,
                  }).then((note) => {
                    if (note?.trim()) void addPin("note", note.trim(), note.trim().slice(0, 40));
                  });
                }}
              >
                <code>+ 钉入备注</code>
                <span>固定约束</span>
              </button>
              <button
                type="button"
                className="slash-item"
                onClick={() => {
                  setPlusOpen(false);
                  const others = recentConversations.filter((c) => c.id !== conversationId);
                  if (others.length === 0) {
                    setActionNotice("没有其它会话可关联");
                    return;
                  }
                  void (async () => {
                    const pick = await appPrompt({
                      title: "钉入会话（#session）",
                      message:
                        "输入序号：\n" +
                        others
                          .slice(0, 12)
                          .map((c, i) => `${i + 1}. ${c.title || c.id} (${c.id})`)
                          .join("\n"),
                    });
                    const n = Number(pick);
                    if (!n || n < 1 || n > Math.min(12, others.length)) return;
                    const row = others[n - 1];
                    void addPin("session", row.id, row.title || row.id);
                  })();
                }}
              >
                <code>#会话</code>
                <span>关联其它对话进上下文</span>
              </button>
              <button
                type="button"
                className="slash-item"
                onClick={() => {
                  setPlusOpen(false);
                  setComposer("/goal ");
                }}
              >
                <code>/goal</code>
                <span>设定会话目标</span>
              </button>
              <button
                type="button"
                className="slash-item"
                onClick={() => {
                  setPlusOpen(false);
                  void runCompact();
                }}
              >
                <code>/compact</code>
                <span>显式压缩</span>
              </button>
              <button
                type="button"
                className="slash-item"
                onClick={() => {
                  setPlusOpen(false);
                  setComposer("/");
                  setSlashOpen(true);
                }}
              >
                <code>/命令与能力</code>
                <span>按需调用，不常驻输入区</span>
              </button>
            </div>
          )}
          <div className="composer-toolbar">
            <div className="composer-toolbar-left">
              <button
                type="button"
                className={plusOpen ? "composer-icon-btn active" : "composer-icon-btn"}
                onClick={() => {
                  setPlusOpen((open) => !open);
                  setSlashOpen(false);
                  setAtOpen(false);
                }}
                title="附件 · @ · 钉入 · 命令"
                aria-label="打开附加菜单"
              >
                +
              </button>
              <label className="composer-pill select-pill" title="权限拨盘">
                <select
                  value={permissionMode}
                  onChange={(event) =>
                    setPermissionMode(
                      event.target.value as "confirm" | "auto_edit" | "full" | "plan",
                    )
                  }
                >
                  <option value="plan">目标/计划</option>
                  <option value="auto_edit">自动编辑</option>
                  <option value="confirm">变更前确认</option>
                  <option value="full">完全访问</option>
                </select>
              </label>
              {profiles.length > 0 && (
                <label className="composer-pill select-pill model-pill" title="模型档案">
                  <select
                    value={activeProfileId ?? ""}
                    onChange={(event) => onProfileChange?.(event.target.value)}
                  >
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label || profile.model}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="composer-pill select-pill" title="思考深度">
                <select
                  value={thinkingLevel}
                  onChange={(event) =>
                    setThinkingLevel(
                      event.target.value as
                        | "off"
                        | "minimal"
                        | "low"
                        | "medium"
                        | "high"
                        | "xhigh"
                        | "max",
                    )
                  }
                >
                  <option value="off">思考关</option>
                  <option value="low">思考低</option>
                  <option value="medium">思考中</option>
                  <option value="high">思考高</option>
                  <option value="max">思考最高</option>
                </select>
              </label>
            </div>
            <div className="composer-toolbar-right">
              <button
                type="button"
                className={recording ? "composer-icon-btn active" : "composer-icon-btn ghost"}
                onClick={() => void toggleRecording()}
                title={asrReady ? (recording ? "停止录音并转写" : "本地 SenseVoice 语音输入") : "先在能力页安装 SenseVoice"}
                aria-label={recording ? "停止录音" : "语音输入"}
              >
                {recording ? "■" : "🎙"}
              </button>
              {(stream.state.streaming || stream.busy) && composer.trim() && (
                <button
                  type="button"
                  className="composer-pill quiet"
                  onClick={() => submit("now")}
                  title="立即插入当前回合（⌘Enter）"
                >
                  立即
                </button>
              )}
              {stream.state.streaming || stream.busy ? (
                <button
                  type="button"
                  className="send-button stop"
                  onClick={() => void stream.abort()}
                  title="中断"
                  aria-label="中断"
                >
                  <Icon name="stop" size={15} />
                </button>
              ) : (
                <button
                  type="button"
                  className="send-button"
                  disabled={!composer.trim() && pendingImages.length === 0}
                  onClick={() => submit("queue")}
                  title="发送（忙碌时自动排队；可附带粘贴图片）"
                  aria-label="发送"
                >
                  <Icon name="send" size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
        {(stream.notice || actionNotice) && !queuedHint && (
          <p className="composer-notice" role="status">
            {actionNotice ?? stream.notice}
          </p>
        )}
        <p className="composer-note">
          {inWork
            ? `${activeProject?.name ?? "项目"} · ${
                permissionMode === "full"
                  ? "完全访问"
                  : permissionMode === "auto_edit"
                    ? "自动编辑"
                    : permissionMode === "plan"
                      ? "目标/计划"
                      : "变更前确认"
              }`
            : "助理目录"}
          {localGoal?.trim() ? " · 有目标" : ""}
          {localPins.length > 0 ? ` · 钉入${localPins.length}` : ""}
          {stream.busy || stream.state.streaming ? " · Enter 排队 · ⌘Enter 立即" : ""}
          {conversationId ? "" : " · 发送后开新对话"}
          {usageLabel ? ` · ${usageLabel}` : ""}
        </p>
      </footer>
    </main>
  );
}
