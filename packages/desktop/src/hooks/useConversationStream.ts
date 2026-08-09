/**
 * Conversation stream hook: subscribes the conversation channel and reduces
 * every event through the pure reducer. Owns prompt/abort/mode-switch
 * actions; the RPC-driven mode switches apply their results as synthetic
 * events (the host only broadcasts mode.changed for model-initiated flips).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Conversation, Message, Project, Task, WorkProposal } from "@penglai/protocol";
import type { PenglaiBridge, SubscriptionState } from "../bridge/types.js";
import { toBridgeError } from "../bridge/types.js";
import {
  initialStreamState,
  loadTranscript,
  reduceConversationEvent,
  type StreamState,
} from "../state/conversation.js";

export interface ConversationStream {
  state: StreamState;
  subState: SubscriptionState | null;
  busy: boolean;
  notice: string | null;
  send: (
    text: string,
    options?: {
      delivery?: "queue" | "now";
      permissionMode?: "confirm" | "auto_edit" | "full" | "plan";
      thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
      images?: Array<{ data: string; mimeType: string; name?: string }>;
    },
  ) => Promise<void>;
  abort: () => Promise<void>;
  proposeWork: (input: {
    projectId?: string;
    rootPath?: string;
    objective?: string;
    title?: string;
    /** Override when the React selection just created a conversation but this hook still holds null. */
    conversationId?: string;
  }) => Promise<{ task: Task; project: Project } | null>;
  exitWork: (outcome: "completed" | "paused") => Promise<void>;
  clearNotice: () => void;
}

export function useConversationStream(
  bridge: PenglaiBridge,
  conversationId: string | null,
  /** Bump to force a reload + resubscribe (host restart generation). */
  resetKey = 0,
): ConversationStream {
  const [state, setState] = useState<StreamState>(() => initialStreamState(null));
  const [subState, setSubState] = useState<SubscriptionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setState(initialStreamState(null));
      return;
    }
    let unsubscribe: (() => void) | null = null;
    let active = true;
    setState(initialStreamState(null));
    setSubState(null);
    void bridge
      .rpc<{ conversation: Conversation; messages: Message[] }>("conversation.get", {
        conversationId,
      })
      .then(({ conversation, messages }) => {
        if (active) {
          setState((current) => loadTranscript(current, conversation, messages));
        }
      })
      .catch((error) => {
        if (active) setNotice(`无法读取会话：${String(error)}`);
      });
    void bridge
      .subscribe(
        conversationId,
        (event) => {
          if (mounted.current) {
            setState((current) => reduceConversationEvent(current, event));
            const kind = typeof event.event === "string" ? event.event : "";
            if (kind === "conversation.prompt.started") setBusy(true);
            if (
              kind === "conversation.prompt.completed" ||
              kind === "conversation.prompt.failed" ||
              kind === "conversation.prompt.aborted" ||
              kind === "conversation.prompt.budget"
            ) {
              setBusy(false);
            }
          }
        },
        setSubState,
      )
      .then((stop) => {
        if (active) unsubscribe = stop;
        else stop();
      })
      .catch(() => {
        if (active) setSubState("closed");
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [bridge, conversationId, resetKey]);

  const send = useCallback(
    async (
      text: string,
      options?: {
        delivery?: "queue" | "now";
        permissionMode?: "confirm" | "auto_edit" | "full" | "plan";
        thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
        images?: Array<{ data: string; mimeType: string; name?: string }>;
      },
    ) => {
      const images = options?.images ?? [];
      if (!conversationId || (!text.trim() && images.length === 0)) return;
      // When busy, still allow queue/steer (Pi-native); only block empty.
      const delivery = options?.delivery ?? "queue";
      const isQueueAckPath = busy || state.streaming;
      setBusy(true);
      setNotice(null);
      try {
        const result = await bridge.rpc<{ text?: string; stopDetail?: string | null }>("conversation.prompt", {
          conversationId,
          text: text.trim(),
          permissionMode: options?.permissionMode ?? "auto_edit",
          thinkingLevel: options?.thinkingLevel ?? "medium",
          delivery,
          images: images.length > 0 ? images : undefined,
        });
        if (result?.stopDetail === "queued" || result?.text?.includes("queued")) {
          setNotice("已排队 · 当前回复结束后自动发送");
        } else if (result?.stopDetail === "steered" || result?.text?.includes("steered")) {
          setNotice("已立即插入当前回合");
        }
      } catch (error) {
        const shaped = toBridgeError(error);
        setNotice(
          shaped.code === "budget_exceeded"
            ? `已触发预算熔断：${shaped.message}`
            : shaped.code === "conversation_busy"
              ? "排队失败：回合仍忙，可 ⌘Enter 立即插入或稍后再试"
              : `发送失败：${shaped.message}`,
        );
      } finally {
        // Queue/steer acks return while the episode is still streaming; keep
        // busy true if stream events still mark the turn live.
        if (mounted.current) {
          setBusy(isQueueAckPath ? state.streaming : false);
        }
      }
    },
    [bridge, busy, conversationId, state.streaming],
  );

  const abort = useCallback(async () => {
    if (!conversationId) return;
    try {
      await bridge.rpc("conversation.abort", { conversationId });
    } catch (error) {
      setNotice(`中断失败：${String(error)}`);
    }
  }, [bridge, conversationId]);

  const proposeWork = useCallback(
    async (input: {
      projectId?: string;
      rootPath?: string;
      objective?: string;
      title?: string;
      conversationId?: string;
    }) => {
      const targetId = input.conversationId ?? conversationId;
      if (!targetId) {
        setNotice("还没有对话：请先点「选项目」或发一条消息以创建会话，再进入项目。");
        return null;
      }
      setBusy(true);
      setNotice(null);
      try {
        const result = await bridge.rpc<{
          conversation: Conversation;
          project: Project | null;
          proposal: WorkProposal;
          task: null;
        }>("mode.proposeWork", {
          conversationId: targetId,
          projectId: input.projectId ?? null,
          rootPath: input.rootPath ?? null,
          // Empty objective → Host supplies a light-anchor default.
          objective: input.objective?.trim() || "",
          title: input.title ?? null,
          sourceChannel: "desktop",
        });
        // This callback is invoked only by an explicit Owner UI action. The
        // second RPC is the authority boundary; proposal itself stays inert.
        const confirmed = await bridge.rpc<{
          conversation: Conversation;
          project: Project;
          task: Task;
        }>("mode.confirmWork", {
          proposalId: result.proposal.id,
          conversationId: targetId,
          confirmedRootPath: result.proposal.canonicalRootPath,
          confirmedBy: "desktop:owner",
        });
        // RPC-initiated flips do not broadcast; apply the card synthetically.
        setState((current) =>
          reduceConversationEvent(current, {
            event: "conversation.mode.changed",
            mode: "work",
            activeTaskId: confirmed.task.id,
            task: confirmed.task,
            project: confirmed.project,
          }),
        );
        return { task: confirmed.task, project: confirmed.project };
      } catch (error) {
        const shaped = toBridgeError(error);
        setNotice(`锚定项目失败：${shaped.message}`);
        return null;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [bridge, conversationId],
  );

  const exitWork = useCallback(
    async (outcome: "completed" | "paused") => {
      if (!conversationId) return;
      try {
        await bridge.rpc("mode.exitWork", { conversationId, outcome });
        setState((current) => ({
          ...current,
          mode: "chat",
          activeTaskId: null,
        }));
      } catch (error) {
        setNotice(`退出工作模式失败：${String(error)}`);
      }
    },
    [bridge, conversationId],
  );

  return {
    state,
    subState,
    busy,
    notice,
    send,
    abort,
    proposeWork,
    exitWork,
    clearNotice: () => setNotice(null),
  };
}
