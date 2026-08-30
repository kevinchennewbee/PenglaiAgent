import { PenglaiError } from "@penglai/contracts";
import type { DshAgentLike, DshHost, DshModelSelection } from "./owner-ports.js";

interface AlphaSessionSummary {
  sessionId: string;
  projections?: { values?: Record<string, unknown> };
}

interface AlphaSessionEvent {
  type?: string;
  data?: unknown;
}

interface AlphaSessionController {
  list(request: { cursor?: string }, signal: AbortSignal): Promise<{ items: readonly AlphaSessionSummary[] }>;
  create(request: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }): Promise<{ sessionId: string }>;
  inspect(sessionId: string, signal?: AbortSignal): Promise<{ events: readonly AlphaSessionEvent[] }>;
  modelCatalog(): Promise<{
    default: DshModelSelection;
    routableProviders: readonly string[];
    groups: readonly { id: string; name: string; models: readonly { id: string; name: string }[] }[];
  }>;
  selectModel(request: { sessionId: string } & DshModelSelection): Promise<{ selected: DshModelSelection }>;
  rename(request: { sessionId: string; title: string }): Promise<{ title: string; seq: number }>;
}

/** Exact alpha.1 Host services used by Penglai. No rc.2 apiProxy compatibility face is admitted. */
export interface Alpha1CordisLike {
  on(event: string, listener: (...args: unknown[]) => unknown, options?: Record<string, unknown>): void | (() => unknown);
  agents?: {
    get(id: string): unknown;
    resume?(opts: { resumeSessionId: string }): Promise<unknown>;
  };
  workspaceRegistry?: {
    list(): Array<{ id: string; title?: string; sessionIds?: string[]; group?: string; folder?: string }>;
  };
  sessionController?: AlphaSessionController;
}

function modelSelection(value: unknown): DshModelSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.provider !== "string" || typeof row.model !== "string") return undefined;
  return {
    provider: row.provider,
    model: row.model,
    ...(typeof row.reasoningEffort === "string" ? { reasoningEffort: row.reasoningEffort } : {}),
  };
}

/** Fold the official alpha.1 model-selection events when a cold list projection is unavailable. */
export function foldAlpha1ModelSelection(events: readonly AlphaSessionEvent[]): DshModelSelection | undefined {
  let lastUsed: DshModelSelection | undefined;
  let pending: DshModelSelection | undefined;
  for (const event of events) {
    const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : undefined;
    if (event.type === "model/selection") {
      pending = modelSelection(data);
      continue;
    }
    if (event.type !== "request/header") continue;
    const header = data?.header && typeof data.header === "object" ? data.header as Record<string, unknown> : undefined;
    const used = modelSelection(header?.config);
    if (!used) continue;
    lastUsed = used;
    if (
      pending?.provider === used.provider &&
      pending.model === used.model &&
      pending.reasoningEffort === used.reasoningEffort
    ) pending = undefined;
  }
  return pending ?? lastUsed;
}

function requiredController(ctx: Alpha1CordisLike): AlphaSessionController {
  if (!ctx.sessionController) {
    throw new PenglaiError("DSH_UNAVAILABLE", "official alpha.1 sessionController is required");
  }
  return ctx.sessionController;
}

export function hostFromAlpha1Cordis(ctx: Alpha1CordisLike, version: string): DshHost {
  const handles = new Map<string, { agent?: DshAgentLike; dispose?: () => Promise<void> }>();
  return {
    version,
    getAgent(sessionId: string) {
      const live = ctx.agents?.get(sessionId) as DshAgentLike | undefined;
      return live ?? handles.get(sessionId)?.agent;
    },
    async resumeAgent(sessionId: string) {
      if (!ctx.agents?.resume) throw new PenglaiError("DSH_UNAVAILABLE", "official alpha.1 agents.resume is required");
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
        ...((workspace.group ?? workspace.folder) ? { group: String(workspace.group ?? workspace.folder) } : {}),
      }));
    },
    async listSessions() {
      const controller = requiredController(ctx);
      const result = await controller.list({}, new AbortController().signal);
      return result.items.map((item) => {
        const title = item.projections?.values?.title;
        return { id: item.sessionId, ...(typeof title === "string" ? { title } : {}) };
      });
    },
    async createSession(workspaceIdentity: string, title?: string) {
      const controller = requiredController(ctx);
      const created = await controller.create({ workspaceId: workspaceIdentity });
      if (title?.trim()) await controller.rename({ sessionId: created.sessionId, title });
      return { id: created.sessionId };
    },
    async describeSessionModels(sessionId: string) {
      const controller = requiredController(ctx);
      const [catalog, listed] = await Promise.all([
        controller.modelCatalog(),
        controller.list({}, new AbortController().signal),
      ]);
      const summary = listed.items.find((item) => item.sessionId === sessionId);
      const projection = summary?.projections?.values?.modelSelection;
      const projected = projection && typeof projection === "object"
        ? modelSelection((projection as Record<string, unknown>).next)
        : undefined;
      const inspected = projected ? undefined : await controller.inspect(sessionId);
      const current = projected ?? foldAlpha1ModelSelection(inspected?.events ?? []) ?? catalog.default;
      const groups = catalog.groups.map((group) => ({
        id: group.id,
        name: group.name,
        models: group.models.map((entry) => ({ id: entry.id, name: entry.name })),
      }));
      return {
        current,
        routable: catalog.routableProviders.includes(current.provider) &&
          groups.some((group) => group.id === current.provider && group.models.some((entry) => entry.id === current.model)),
        groups,
      };
    },
    async selectSessionModel(sessionId, selection) {
      const result = await requiredController(ctx).selectModel({ sessionId, ...selection });
      return result.selected;
    },
  };
}
