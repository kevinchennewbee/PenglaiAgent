import { PenglaiError, snapshotOfficialSession } from "@penglai/contracts";
import type { RoutingControlPlane } from "@penglai/routing-core";
import { claimedFromOfficial, textFromAssistantMessage } from "./index.js";
import type { DshHost } from "./owner-ports.js";
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

function durableEvent(raw: unknown): {
  type: string;
  turn?: number;
  message?: Record<string, unknown>;
  inserted?: unknown[];
  text: string;
} {
  const rec = asRecord(raw);
  const data = asRecord(rec?.data) ?? rec ?? {};
  const message = asRecord(data.message) ?? asRecord(rec?.message);
  const turn = typeof data.turn === "number" ? data.turn : typeof rec?.turn === "number" ? rec.turn : undefined;
  const inserted = Array.isArray(data.inserted) ? data.inserted : Array.isArray(rec?.inserted) ? rec.inserted : undefined;
  return {
    type: String(rec?.type ?? data.type ?? ""),
    ...(turn !== undefined ? { turn } : {}),
    ...(message ? { message } : {}),
    ...(inserted ? { inserted } : {}),
    text: textFromAssistantMessage(message ?? {}),
  };
}

/**
 * Rebuild claimed-turn/final/outbox from the official durable Session log.
 * Live `assistant/message` is only in memory until turn/end; crash recovery
 * must not invent a final for an unclosed turn, and must not enqueue twice.
 */
export function recoverOfficialTurnDelivery(
  plane: Pick<RoutingControlPlane, "onClaimed" | "onAssistantFinal">,
  input: { sessionId: string; events: readonly unknown[] },
): { claimed: number; delivered: number; incomplete: number } {
  if (!input.sessionId.trim()) {
    throw new PenglaiError("INVALID_INPUT", "official session id required");
  }
  let currentTurn: number | undefined;
  const claims = new Map<number, NonNullable<ReturnType<typeof claimedFromOfficial>>>();
  const texts = new Map<number, string>();
  const ended = new Set<number>();

  const rememberClaim = (turn: number | undefined, message: Record<string, unknown> | undefined) => {
    const used = turn ?? currentTurn;
    if (typeof used !== "number" || typeof message?.id !== "string" || !message.id) return;
    const fact = claimedFromOfficial({
      message: { id: message.id, source: message.source ?? { kind: "unknown" } },
      turn: used,
      sessionId: input.sessionId,
    });
    if (fact) claims.set(used, fact);
  };

  for (const raw of input.events) {
    const ev = durableEvent(raw);
    if (ev.type === "turn/start" && typeof ev.turn === "number") currentTurn = ev.turn;
    if (ev.type === "agent/inbox/claimed") rememberClaim(ev.turn, ev.message ?? asRecord(asRecord(raw)?.data));
    if (ev.type === "user/message") rememberClaim(ev.turn, ev.message);
    if (ev.type === "agent/inbox/spliced") {
      for (const item of ev.inserted ?? []) rememberClaim(ev.turn, asRecord(item));
    }
    if (ev.type === "assistant/message") {
      const used = ev.turn ?? currentTurn;
      if (typeof used === "number" && ev.text.trim()) texts.set(used, ev.text);
    }
    if (ev.type === "turn/end") {
      const used = ev.turn ?? currentTurn;
      if (typeof used === "number") ended.add(used);
      currentTurn = undefined;
    }
  }

  let claimed = 0;
  let delivered = 0;
  let incomplete = 0;
  for (const [turn, fact] of claims) {
    if (!ended.has(turn)) {
      incomplete += 1;
      continue;
    }
    plane.onClaimed(fact);
    claimed += 1;
    const text = texts.get(turn);
    if (!text?.trim()) {
      incomplete += 1;
      continue;
    }
    plane.onAssistantFinal({ sessionId: input.sessionId, turnId: String(turn), text });
    delivered += 1;
  }
  return { claimed, delivered, incomplete };
}

export async function recoverOfficialDeliveriesFromHost(
  host: DshHost,
  plane: Pick<RoutingControlPlane, "onClaimed" | "onAssistantFinal">,
): Promise<{ sessions: number; claimed: number; delivered: number; incomplete: number }> {
  const totals = { sessions: 0, claimed: 0, delivered: 0, incomplete: 0 };
  if (!host.listSessions) return totals;
  let sessions: Awaited<ReturnType<NonNullable<DshHost["listSessions"]>>> = [];
  try {
    sessions = await host.listSessions();
  } catch (error) {
    if (error instanceof PenglaiError && error.errorClass === "DSH_UNAVAILABLE") return totals;
    throw error;
  }
  for (const session of sessions) {
    const agent = host.getAgent(session.id);
    if (!agent?.session) continue;
    totals.sessions += 1;
    const result = recoverOfficialTurnDelivery(plane, {
      sessionId: session.id,
      events: snapshotOfficialSession(agent.session),
    });
    totals.claimed += result.claimed;
    totals.delivered += result.delivered;
    totals.incomplete += result.incomplete;
  }
  return totals;
}
