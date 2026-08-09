/**
 * Conversation stream state — pure reducer for the chat-mode surface.
 *
 * Product contract (result surface):
 *   - durable assistant text = cleaned final answer only
 *   - thinking / tools = collapsible activity (default folded in UI)
 *   - live streaming bubble is replaced (not stacked) when the episode ends
 */

import type {
  Conversation,
  Message,
  MessageContent,
  Mode,
  Project,
  Task,
  TextContent,
} from "@penglai/protocol";

const MAX_TOOLS = 20;
const MAX_EXTRAS = 50;

const THINK_BLOCK_RE = /<(think|thinking)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi;
const OPEN_THINK_RE = /<(think|thinking)(?:\s[^>]*)?>/i;

/** Defense-in-depth cleaner for any leftover provider tags in transcript text. */
export function cleanDisplayText(text: string): string {
  let value = String(text ?? "");
  value = value.replace(THINK_BLOCK_RE, "");
  const open = OPEN_THINK_RE.exec(value);
  if (open && open.index !== undefined) value = value.slice(0, open.index);
  value = value.replace(/<\/?(?:think|thinking|summary|tool_use|file_content)(?:\s[^>]*)?>/gi, "");
  return value.replace(/\n{3,}/g, "\n\n").trim();
}

export interface ToolActivity {
  toolCallId: string | null;
  toolName: string;
  /** null = running; true/false = settled. */
  ok: boolean | null;
}

export type StreamExtra =
  | {
      kind: "mode";
      at: number;
      mode: Mode;
      task: Task;
      project: Project;
    }
  | {
      kind: "notice";
      at: number;
      tone: "info" | "warn" | "alert" | "ok";
      text: string;
    }
  | {
      kind: "thinking";
      at: number;
      text: string;
    };

export interface StreamState {
  /** Durable transcript (deduped by message id, append-only). */
  messages: Message[];
  /** Live episode delta accumulation (one streaming bubble). */
  streamingText: string;
  /** An episode is in flight (prompt.started seen, terminal pending). */
  streaming: boolean;
  /** Tool calls of the in-flight episode (bounded). */
  tools: ToolActivity[];
  /** In-flight thinking excerpt (cleared on episode end). */
  streamingThinking: string;
  /** Conversation mode mirror (mode.changed events + loads). */
  mode: Mode;
  activeTaskId: string | null;
  /** Mode cards / notices / thinking activity interleaved by timestamp. */
  extras: StreamExtra[];
}

export function initialStreamState(conversation: Conversation | null): StreamState {
  return {
    messages: [],
    streamingText: "",
    streaming: false,
    tools: [],
    streamingThinking: "",
    mode: conversation?.mode ?? "chat",
    activeTaskId: conversation?.activeTaskId ?? null,
    extras: [],
  };
}

function endEpisode(state: StreamState, patch: Partial<StreamState> = {}): StreamState {
  // Replace live bubble — never stack with the durable final message.
  return {
    ...state,
    streaming: false,
    streamingText: "",
    streamingThinking: "",
    tools: [],
    ...patch,
  };
}

/** Load a durable transcript (conversation.get) into the stream state. */
export function loadTranscript(
  state: StreamState,
  conversation: Conversation,
  messages: Message[],
): StreamState {
  const known = new Set(state.messages.map((message) => message.id));
  const merged = [...state.messages];
  for (const message of messages) {
    if (!known.has(message.id)) merged.push(message);
  }
  merged.sort((a, b) => a.createdAt - b.createdAt);
  return {
    ...state,
    messages: merged,
    mode: conversation.mode,
    activeTaskId: conversation.activeTaskId,
  };
}

export function messageText(message: Message): string {
  const raw = message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");
  return cleanDisplayText(raw);
}

function appendExtra(state: StreamState, extra: StreamExtra): StreamState {
  const extras = [...state.extras, extra].slice(-MAX_EXTRAS);
  return { ...state, extras };
}

function upsertTool(
  tools: ToolActivity[],
  update: ToolActivity,
): ToolActivity[] {
  const index = tools.findIndex(
    (tool) => tool.toolCallId !== null && tool.toolCallId === update.toolCallId,
  );
  if (index === -1) return [...tools, update].slice(-MAX_TOOLS);
  const next = [...tools];
  next[index] = { ...next[index], ...update };
  return next;
}

/** Reduce one Host conversation-channel event. Unknown events are no-ops. */
export function reduceConversationEvent(
  state: StreamState,
  event: Record<string, unknown>,
): StreamState {
  switch (event.event) {
    case "conversation.message.user":
    case "conversation.message.assistant": {
      const message = event.message as Message | undefined;
      if (!message || typeof message.id !== "string") return state;
      if (state.messages.some((existing) => existing.id === message.id)) return state;
      return {
        ...state,
        messages: [...state.messages, message].sort((a, b) => a.createdAt - b.createdAt),
      };
    }
    case "conversation.prompt.started":
      return {
        ...state,
        streaming: true,
        streamingText: "",
        streamingThinking: "",
        tools: [],
      };
    case "conversation.delta": {
      const delta = typeof event.textDelta === "string" ? event.textDelta : "";
      if (!delta) return state;
      return { ...state, streaming: true, streamingText: state.streamingText + delta };
    }
    case "conversation.thinking": {
      const text = typeof event.text === "string" ? event.text.trim() : "";
      if (!text) return state;
      // Prefer durable activity entry once Host publishes the split thinking.
      return appendExtra(
        { ...state, streamingThinking: text },
        { kind: "thinking", at: Date.now(), text },
      );
    }
    case "conversation.tool.started":
      return {
        ...state,
        tools: upsertTool(state.tools, {
          toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : null,
          toolName: typeof event.toolName === "string" ? event.toolName : "tool",
          ok: null,
        }),
      };
    case "conversation.tool.completed":
      return {
        ...state,
        tools: upsertTool(state.tools, {
          toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : null,
          toolName: typeof event.toolName === "string" ? event.toolName : "tool",
          ok: event.isError === true ? false : true,
        }),
      };
    case "conversation.mode.changed": {
      const task = event.task as Task | undefined;
      const project = event.project as Project | undefined;
      const mode = event.mode === "work" ? "work" : "chat";
      const next: StreamState = {
        ...state,
        mode,
        activeTaskId: typeof event.activeTaskId === "string" ? event.activeTaskId : null,
      };
      if (mode === "work" && task && project) {
        return appendExtra(next, {
          kind: "mode",
          at: Date.now(),
          mode,
          task,
          project,
        });
      }
      return next;
    }
    case "conversation.prompt.blocked":
      return appendExtra(endEpisode(state), {
        kind: "notice",
        at: Date.now(),
        tone: "warn",
        text: `已熔断：${String(event.reason ?? "预算耗尽")}`,
      });
    case "conversation.prompt.aborted":
      return appendExtra(endEpisode(state), {
        kind: "notice",
        at: Date.now(),
        tone: "info",
        text: "已中断",
      });
    case "conversation.prompt.budget":
      return appendExtra(endEpisode(state), {
        kind: "notice",
        at: Date.now(),
        tone: "warn",
        text: `episode 撞预算：${String(event.stopDetail ?? "")}`,
      });
    case "conversation.prompt.failed":
      return appendExtra(endEpisode(state), {
        kind: "notice",
        at: Date.now(),
        tone: "alert",
        text: `episode 失败：${String(event.stopDetail ?? "未知错误")}`,
      });
    case "conversation.prompt.completed":
      return endEpisode(state);
    case "budget.warning":
      return appendExtra(state, {
        kind: "notice",
        at: Date.now(),
        tone: "warn",
        text: `预算预警：${String(event.message ?? "")}`,
      });
    case "budget.tripped":
      return appendExtra(state, {
        kind: "notice",
        at: Date.now(),
        tone: "alert",
        text: `预算熔断：${String(event.message ?? "")}`,
      });
    case "budget.lifted":
      return appendExtra(state, {
        kind: "notice",
        at: Date.now(),
        tone: "ok",
        text: `预算放行：${String(event.message ?? "")}`,
      });
    default:
      return state;
  }
}

// ── render items ───────────────────────────────────────────────

export type StreamImage = {
  mimeType: string;
  data: string;
  name?: string;
};

export type StreamItem =
  | {
      kind: "message";
      id: string;
      role: Message["role"];
      text: string;
      at: number;
      images?: StreamImage[];
    }
  | { kind: "streaming"; text: string; tools: ToolActivity[]; thinking: string }
  | { kind: "thinking"; text: string }
  | { kind: "mode"; task: Task; project: Project }
  | { kind: "notice"; tone: "info" | "warn" | "alert" | "ok"; text: string };

function messageImages(message: Message): StreamImage[] {
  const out: StreamImage[] = [];
  for (const part of message.content) {
    if (part.type !== "image") continue;
    if (!part.data || !part.mimeType) continue;
    out.push({
      mimeType: part.mimeType,
      data: part.data,
      name: part.name,
    });
  }
  return out;
}

/**
 * Merge durable transcript with activity / notices by timestamp.
 * Live bubble only while an episode is in flight (never stacked after final).
 */
export function streamItems(state: StreamState): StreamItem[] {
  const items: Array<{ at: number; item: StreamItem }> = [];
  for (const message of state.messages) {
    const text = messageText(message);
    const images = messageImages(message);
    if (!text.trim() && images.length === 0) continue;
    items.push({
      at: message.createdAt,
      item: {
        kind: "message",
        id: message.id,
        role: message.role,
        text,
        at: message.createdAt,
        images: images.length > 0 ? images : undefined,
      },
    });
  }
  for (const extra of state.extras) {
    if (extra.kind === "mode") {
      items.push({ at: extra.at, item: { kind: "mode", task: extra.task, project: extra.project } });
    } else if (extra.kind === "thinking") {
      items.push({ at: extra.at, item: { kind: "thinking", text: extra.text } });
    } else {
      items.push({
        at: extra.at,
        item: { kind: "notice", tone: extra.tone, text: extra.text },
      });
    }
  }
  items.sort((a, b) => a.at - b.at);
  const merged = items.map((entry) => entry.item);
  // Only show the live bubble while the episode is open. Terminal events must
  // clear streamingText so we never double-render with the durable final.
  if (state.streaming) {
    merged.push({
      kind: "streaming",
      text: cleanDisplayText(state.streamingText),
      tools: state.tools,
      thinking: state.streamingThinking,
    });
  }
  return merged;
}

/** Tool-call counts for the streaming bubble caption. */
export function toolSummary(tools: ToolActivity[]): { total: number; failed: number; running: number } {
  return {
    total: tools.length,
    failed: tools.filter((tool) => tool.ok === false).length,
    running: tools.filter((tool) => tool.ok === null).length,
  };
}

export type { MessageContent };
