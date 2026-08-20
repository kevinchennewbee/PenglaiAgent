import { randomUUID } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import type { RoutingControlPlane } from "@penglai/routing-core";
import { claimedFromOfficial, textFromAssistantMessage, type DshAgentLike, type DshHost } from "./index.js";

export interface CordisLike {
  on(event: string, listener: (...args: unknown[]) => unknown, options?: Record<string, unknown>): void | (() => unknown);
  agents?: {
    get(id: string): unknown;
    resume?(opts: { resumeSessionId: string }): Promise<unknown>;
  };
  workspaceRegistry?: {
    list(): Array<{ id: string; title?: string; sessionIds?: string[]; group?: string; folder?: string }>;
  };
  apiProxy?: {
    sessions?: {
      create(request: {
        rpcId: string;
        payload: { workspaceId: string };
      }): Promise<{
        result:
          | { ok: true; value: { sessionId: string } }
          | { ok: false; error: { code?: string; message?: string } };
      }>;
      models?(request: { rpcId: string; payload: { sessionId: string } }): Promise<{
        result:
          | { ok: true; value: { current: { provider: string; model: string; reasoningEffort?: string }; routable: boolean; groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }> } }
          | { ok: false; error: { code?: string; message?: string } };
      }>;
      selectModel?(request: { rpcId: string; payload: { sessionId: string; provider: string; model: string; reasoningEffort?: string } }): Promise<{
        result:
          | { ok: true; value: { selected: { provider: string; model: string; reasoningEffort?: string } } }
          | { ok: false; error: { code?: string; message?: string } };
      }>;
    };
  };
}

export function hostFromCordis(ctx: CordisLike, version: string): DshHost {
  const handles = new Map<string, { agent?: DshAgentLike; dispose?: () => Promise<void> }>();
  return {
    version,
    getAgent(sessionId: string) {
      const live = ctx.agents?.get(sessionId) as DshAgentLike | undefined;
      if (live) return live;
      return handles.get(sessionId)?.agent;
    },
    async resumeAgent(sessionId: string) {
      if (!ctx.agents?.resume) throw new Error("resume unavailable");
      const { unwrapAgent, isAgentHandle } = await import("./contracts.js");
      const raw = await ctx.agents.resume({ resumeSessionId: sessionId });
      if (isAgentHandle(raw)) handles.set(sessionId, raw);
      return unwrapAgent(raw);
    },
    listWorkspaces() {
      return (ctx.workspaceRegistry?.list() ?? []).map((w) => ({
        id: w.id,
        title: w.title ?? w.id,
        sessionIds: [...(w.sessionIds ?? [])],
        ...((w.group ?? w.folder) ? { group: String(w.group ?? w.folder) } : {}),
      }));
    },
    async createSession(workspaceIdentity: string) {
      const proxy = ctx.apiProxy;
      const create = proxy?.sessions?.create;
      if (!create) {
        throw new PenglaiError("DSH_UNAVAILABLE", "official apiProxy.sessions.create is required");
      }
      const response = await create({
        rpcId: randomUUID(),
        payload: { workspaceId: workspaceIdentity },
      });
      if (!response.result.ok) {
        throw new PenglaiError(
          "DSH_UNAVAILABLE",
          `official session.create failed: ${response.result.error.code ?? "unknown"}`,
        );
      }
      return { id: response.result.value.sessionId };
    },
    async describeSessionModels(sessionId: string) {
      const proxy = ctx.apiProxy;
      const models = proxy?.sessions?.models;
      if (!models) throw new PenglaiError("DSH_UNAVAILABLE", "official apiProxy.sessions.models is required");
      const response = await models({ rpcId: randomUUID(), payload: { sessionId } });
      if (!response.result.ok) {
        throw new PenglaiError("DSH_UNAVAILABLE", `official session.models failed: ${response.result.error.code ?? "unknown"}`);
      }
      return response.result.value;
    },
    async selectSessionModel(sessionId, selection) {
      const proxy = ctx.apiProxy;
      const selectModel = proxy?.sessions?.selectModel;
      if (!selectModel) throw new PenglaiError("DSH_UNAVAILABLE", "official apiProxy.sessions.selectModel is required");
      const response = await selectModel({ rpcId: randomUUID(), payload: { sessionId, ...selection } });
      if (!response.result.ok) {
        throw new PenglaiError("DSH_UNAVAILABLE", `official session.selectModel failed: ${response.result.error.code ?? "unknown"}`);
      }
      return response.result.value.selected;
    },
  };
}

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
