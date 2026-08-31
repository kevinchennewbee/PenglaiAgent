import { PenglaiError } from "@penglai/contracts";
import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
import type { DshAgentLike, DshHost, DshModelSelection } from "./owner-ports.js";

interface AlphaSessionSummary {
  sessionId: string;
  projections?: { asOfSeq: number; values?: Record<string, unknown> };
}

interface AlphaSessionEvent {
  type?: string;
  seq?: number;
  time?: number;
  data?: unknown;
  ignorable?: true;
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

/** Exact alpha.2 Host services used by Penglai. No rc.2 apiProxy compatibility face is admitted. */
export interface Alpha2CordisLike {
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

/** Fold the official alpha.2 model-selection events when a cold list projection is unavailable. */
export function foldAlpha2ModelSelection(events: readonly AlphaSessionEvent[]): DshModelSelection | undefined {
  let lastUsed: DshModelSelection | undefined;
  let pending: DshModelSelection | undefined;
  for (const event of events) {
    if (typeof event.type !== "string" || !KNOWN_SESSION_EVENT_TYPES.has(event.type)) {
      if (event.ignorable === true) continue;
      throw new PenglaiError("DSH_CONTRACT_DRIFT", "required alpha.2 Session event is unknown");
    }
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

/** Fold the durable official title event when the list projection is stale. */
export function foldAlpha2Title(events: readonly AlphaSessionEvent[]): string | undefined {
  let title: string | undefined;
  for (const event of events) {
    if (typeof event.type !== "string" || !KNOWN_SESSION_EVENT_TYPES.has(event.type)) {
      if (event.ignorable === true) continue;
      throw new PenglaiError("DSH_CONTRACT_DRIFT", "required alpha.2 Session event is unknown");
    }
    if (event.type !== "session/title") continue;
    const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : undefined;
    if (typeof data?.title !== "string") {
      throw new PenglaiError("DSH_CONTRACT_DRIFT", "official alpha.2 Session title event is malformed");
    }
    title = data.title;
  }
  return title;
}

function requiredController(ctx: Alpha2CordisLike): AlphaSessionController {
  if (!ctx.sessionController) {
    throw new PenglaiError("DSH_UNAVAILABLE", "official alpha.2 sessionController is required");
  }
  return ctx.sessionController;
}

export function hostFromAlpha2Cordis(ctx: Alpha2CordisLike, version: string): DshHost {
  const handles = new Map<string, { agent?: DshAgentLike; dispose?: () => Promise<void> }>();
  return {
    version,
    getAgent(sessionId: string) {
      const live = ctx.agents?.get(sessionId) as DshAgentLike | undefined;
      return live ?? handles.get(sessionId)?.agent;
    },
    async resumeAgent(sessionId: string) {
      if (!ctx.agents?.resume) throw new PenglaiError("DSH_UNAVAILABLE", "official alpha.2 agents.resume is required");
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
      return Promise.all(result.items.map(async (item) => {
        const inspected = await controller.inspect(item.sessionId);
        const events = inspected?.events ?? [];
        const lastSeq = events.reduce(
          (highest, event) => typeof event.seq === "number" ? Math.max(highest, event.seq) : highest,
          -1,
        );
        const projected = item.projections?.values?.title;
        const title = item.projections?.asOfSeq === lastSeq && typeof projected === "string"
          ? projected
          : foldAlpha2Title(events);
        return { id: item.sessionId, ...(typeof title === "string" ? { title } : {}) };
      }));
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
      const inspected = await controller.inspect(sessionId);
      const events = inspected?.events ?? [];
      const lastSeq = events.length ? events[events.length - 1]?.seq : -1;
      const projectionCurrent = projected && summary?.projections?.asOfSeq === lastSeq;
      const current = (projectionCurrent ? projected : foldAlpha2ModelSelection(events)) ?? catalog.default;
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
