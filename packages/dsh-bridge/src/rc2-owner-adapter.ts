import { randomUUID } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import type { DshAgentLike, DshHost } from "./owner-ports.js";

/** Historical rc.2 Cordis services. This shape must not grow into an alpha compatibility facade. */
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

/**
 * Compose the still-active DSH 0.1.1-rc.2 owner faces. ApiProxy is contained
 * here so the bridge and future alpha adapter cannot accidentally depend on it.
 */
export function hostFromRc2Cordis(ctx: CordisLike, version: string): DshHost {
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
      return (ctx.workspaceRegistry?.list() ?? []).map((workspace) => ({
        id: workspace.id,
        title: workspace.title ?? workspace.id,
        sessionIds: [...(workspace.sessionIds ?? [])],
        ...((workspace.group ?? workspace.folder)
          ? { group: String(workspace.group ?? workspace.folder) }
          : {}),
      }));
    },
    async createSession(workspaceIdentity: string) {
      const create = ctx.apiProxy?.sessions?.create;
      if (!create) {
        throw new PenglaiError("DSH_UNAVAILABLE", "official rc.2 apiProxy.sessions.create is required");
      }
      const response = await create({
        rpcId: randomUUID(),
        payload: { workspaceId: workspaceIdentity },
      });
      if (!response.result.ok) {
        throw new PenglaiError(
          "DSH_UNAVAILABLE",
          `official rc.2 session.create failed: ${response.result.error.code ?? "unknown"}`,
        );
      }
      return { id: response.result.value.sessionId };
    },
    async describeSessionModels(sessionId: string) {
      const models = ctx.apiProxy?.sessions?.models;
      if (!models) {
        throw new PenglaiError("DSH_UNAVAILABLE", "official rc.2 apiProxy.sessions.models is required");
      }
      const response = await models({ rpcId: randomUUID(), payload: { sessionId } });
      if (!response.result.ok) {
        throw new PenglaiError(
          "DSH_UNAVAILABLE",
          `official rc.2 session.models failed: ${response.result.error.code ?? "unknown"}`,
        );
      }
      return response.result.value;
    },
    async selectSessionModel(sessionId, selection) {
      const selectModel = ctx.apiProxy?.sessions?.selectModel;
      if (!selectModel) {
        throw new PenglaiError("DSH_UNAVAILABLE", "official rc.2 apiProxy.sessions.selectModel is required");
      }
      const response = await selectModel({
        rpcId: randomUUID(),
        payload: { sessionId, ...selection },
      });
      if (!response.result.ok) {
        throw new PenglaiError(
          "DSH_UNAVAILABLE",
          `official rc.2 session.selectModel failed: ${response.result.error.code ?? "unknown"}`,
        );
      }
      return response.result.value.selected;
    },
  };
}
