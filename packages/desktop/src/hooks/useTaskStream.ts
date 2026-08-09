/**
 * Task stream hook: the task channel drives live output (当前输出, kernel
 * deltas), tool activity, and bundle reloads on every durable state change.
 * The durable bundle (runs/steps/evidence/approvals/checkpoints) stays the
 * single source of truth; the live fields are transient overlays.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PenglaiBridge, SubscriptionState } from "../bridge/types.js";
import type { ToolActivity } from "../state/conversation.js";
import type { TaskBundleLike } from "../state/workbench.js";

export interface TaskStream {
  bundle: TaskBundleLike | null;
  loading: boolean;
  subState: SubscriptionState | null;
  /** Live episode output (cleared at settle; the durable log row carries it). */
  liveOutput: string;
  liveTools: ToolActivity[];
  reload: () => Promise<void>;
}

/** Terminal run events after which the live output freezes to the log row. */
const TERMINAL_EVENTS = new Set([
  "task.run.completed",
  "task.run.failed",
  "task.run.cancelled",
  "task.run.paused",
  "task.run.blocked",
]);

export function useTaskStream(
  bridge: PenglaiBridge,
  taskId: string | null,
  onDurableChange?: () => void,
  /** Bump to force a reload + resubscribe (host restart generation). */
  resetKey = 0,
): TaskStream {
  const [bundle, setBundle] = useState<TaskBundleLike | null>(null);
  const [loading, setLoading] = useState(false);
  const [subState, setSubState] = useState<SubscriptionState | null>(null);
  const [liveOutput, setLiveOutput] = useState("");
  const [liveTools, setLiveTools] = useState<ToolActivity[]>([]);
  const mounted = useRef(true);
  const onDurableChangeRef = useRef(onDurableChange);
  onDurableChangeRef.current = onDurableChange;

  const reload = useCallback(async () => {
    if (!taskId) {
      setBundle(null);
      return;
    }
    try {
      const next = await bridge.rpc<TaskBundleLike>("task.get", { taskId });
      if (mounted.current) setBundle(next);
    } catch {
      if (mounted.current) setBundle(null);
    }
  }, [bridge, taskId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!taskId) {
      setBundle(null);
      setLiveOutput("");
      setLiveTools([]);
      return;
    }
    let unsubscribe: (() => void) | null = null;
    let active = true;
    setLoading(true);
    setLiveOutput("");
    setLiveTools([]);
    setSubState(null);
    void reload().finally(() => {
      if (active && mounted.current) setLoading(false);
    });
    void bridge
      .subscribe(
        taskId,
        (event) => {
          if (!mounted.current) return;
          const kind = typeof event.event === "string" ? event.event : "";
          if (kind === "message.delta" && typeof event.textDelta === "string") {
            // Defense-in-depth: strip protocol think tags from live execution feed.
            const chunk = String(event.textDelta)
              .replace(/<(think|thinking)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, "")
              .replace(/<(think|thinking)(?:\s[^>]*)?>[\s\S]*$/i, "");
            if (!chunk) return;
            setLiveOutput((current) => (current + chunk).slice(-16_000));
            return;
          }
          if (kind === "tool.started") {
            setLiveTools((current) =>
              [
                ...current.filter(
                  (tool) => tool.toolCallId !== (event.toolCallId as string | undefined),
                ),
                {
                  toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : null,
                  toolName: typeof event.toolName === "string" ? event.toolName : "tool",
                  ok: null,
                },
              ].slice(-20),
            );
            return;
          }
          if (kind === "tool.completed") {
            setLiveTools((current) =>
              current.map((tool) =>
                tool.toolCallId === (event.toolCallId as string | undefined)
                  ? { ...tool, ok: event.isError === true ? false : true }
                  : tool,
              ),
            );
          }
          if (kind === "task.run.started") {
            setLiveOutput("");
            setLiveTools([]);
          }
          if (TERMINAL_EVENTS.has(kind)) {
            setLiveOutput("");
            setLiveTools([]);
          }
          // Every other event mutates durable state (run/step/evidence/
          // approval rows): reload the bundle and bubble up (approvals badge,
          // project tree, budget).
          void reload().then(() => onDurableChangeRef.current?.());
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
  }, [bridge, taskId, reload, resetKey]);

  return { bundle, loading, subState, liveOutput, liveTools, reload };
}
