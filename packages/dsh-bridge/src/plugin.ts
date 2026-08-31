import type { RoutingControlPlane } from "@penglai/routing-core";
import { claimedFromOfficial, textFromAssistantMessage } from "./index.js";
import type { CordisLike } from "./rc2-owner-adapter.js";

export {
  foldAlpha2ModelSelection,
  hostFromAlpha2Cordis,
  type Alpha2CordisLike,
} from "./alpha2-owner-adapter.js";

export {
  hostFromRc2Cordis,
  type CordisLike,
} from "./rc2-owner-adapter.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function officialSessionEvent(args: unknown[]): { sessionId: string; type: string; turn?: number; text: string } {
  const first = asRecord(args[0]);
  const second = asRecord(args[1]);
  let sessionId = "";
  let event = first;
  if (second && typeof second.type === "string") {
    sessionId = String(first?.id ?? "");
    event = second;
  } else if (first) {
    const session = asRecord(first.session);
    sessionId = String(session?.id ?? first.id ?? "");
    event = asRecord(first.event) ?? first;
  }
  const data = asRecord(event?.data) ?? event ?? {};
  const message = asRecord(data.message) ?? asRecord(event?.message);
  const turn = typeof data.turn === "number" ? data.turn : typeof event?.turn === "number" ? event.turn : undefined;
  return {
    sessionId,
    type: String(event?.type ?? ""),
    ...(turn !== undefined ? { turn } : {}),
    text: textFromAssistantMessage(message ?? {}),
  };
}

export function listenOfficialEvents(ctx: CordisLike, plane: RoutingControlPlane): void {
  ctx.on("agent/inbox/claimed", (payload) => {
    const rec = asRecord(payload);
    const agent = asRecord(rec?.agent) as { id?: string; session?: { id?: string } } | undefined;
    const message = asRecord(rec?.message) as { id?: string; source?: unknown } | undefined;
    const turn = rec?.turn;
    if (!message?.id || typeof turn !== "number") return;
    const fact = claimedFromOfficial({
      message: { id: message.id, source: message.source ?? { kind: "unknown" } },
      turn,
      sessionId: String(agent?.id ?? agent?.session?.id ?? ""),
    });
    if (fact) plane.onClaimed(fact);
  });
  const finals = new Map<string, string>();
  ctx.on("assistant/message", (payload) => {
    const rec = asRecord(payload);
    const turn = rec?.turn;
    const sessionId = String((asRecord(rec?.session)?.id ?? asRecord(rec?.agent)?.id ?? "") as string);
    if (typeof turn !== "number" || !sessionId) return;
    const text = textFromAssistantMessage(asRecord(rec?.message) ?? {});
    if (text.trim()) finals.set(`${sessionId}:${turn}`, text);
  });
  ctx.on("session/event", (...args: unknown[]) => {
    const ev = officialSessionEvent(args);
    if (ev.type === "assistant/message" && typeof ev.turn === "number" && ev.sessionId && ev.text.trim()) {
      finals.set(`${ev.sessionId}:${ev.turn}`, ev.text);
    }
    if (ev.type === "turn/end" && typeof ev.turn === "number" && ev.sessionId) {
      const text = finals.get(`${ev.sessionId}:${ev.turn}`);
      finals.delete(`${ev.sessionId}:${ev.turn}`);
      if (text) plane.onAssistantFinal({ sessionId: ev.sessionId, turnId: String(ev.turn), text });
    }
  });
  ctx.on("turn/end", (payload) => {
    const rec = asRecord(payload);
    const turn = rec?.turn;
    const sessionId = String((asRecord(rec?.session)?.id ?? asRecord(rec?.agent)?.id ?? "") as string);
    if (typeof turn !== "number" || !sessionId) return;
    const text = finals.get(`${sessionId}:${turn}`);
    finals.delete(`${sessionId}:${turn}`);
    if (text) plane.onAssistantFinal({ sessionId, turnId: String(turn), text });
  });
}
