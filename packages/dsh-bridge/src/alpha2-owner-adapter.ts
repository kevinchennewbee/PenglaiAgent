import { PenglaiError } from "@penglai/contracts";
import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
import type { DshAgentLike, DshHost, DshModelSelection } from "./owner-ports.js";

/** V3 catalog types Penglai must admit even if a pinned dsh-session set lags. Never `assistant/chunk`. */
export const V3_SESSION_EVENT_TYPE_EXTRAS = [
  "system/message",
  "assistant/attempt",
  "tool/ptc-dispatch",
  "tool/ptc-dispatch-start",
] as const;

const OFFICIAL_SESSION_EVENT_TYPES = new Set<string>([
  ...KNOWN_SESSION_EVENT_TYPES,
  ...V3_SESSION_EVENT_TYPE_EXTRAS,
]);

function isKnownOfficialSessionEvent(type: string): boolean {
  return OFFICIAL_SESSION_EVENT_TYPES.has(type);
}

function isSessionAlreadyOwned(error: unknown): boolean {
  const err = error && typeof error === "object" ? (error as { name?: unknown; message?: unknown }) : undefined;
  return err?.name === "SessionAlreadyOwnedError" || /already owned/i.test(String(err?.message ?? error ?? ""));
}

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
  /** Official SessionListRequest.cursor is reserved; list returns every visible row. */
  list(request: { cursor?: string }, signal: AbortSignal): Promise<{
    items: readonly AlphaSessionSummary[];
  }>;
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
    if (typeof event.type !== "string" || !isKnownOfficialSessionEvent(event.type)) {
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
    if (typeof event.type !== "string" || !isKnownOfficialSessionEvent(event.type)) {
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

function isSessionNotFound(error: unknown): boolean {
  const err = error && typeof error === "object" ? (error as { name?: unknown; message?: unknown }) : undefined;
  return err?.name === "ApiSessionNotFound" || /session ".*?" not found/i.test(String(err?.message ?? error ?? ""));
}

async function listOfficialSessions(
  controller: AlphaSessionController,
): Promise<{ items: AlphaSessionSummary[]; projectionError?: unknown }> {
  try {
    const result = await controller.list({}, new AbortController().signal);
    const items: AlphaSessionSummary[] = [];
    const seenIds = new Set<string>();
    for (const item of result.items ?? []) {
      if (!item?.sessionId || seenIds.has(item.sessionId)) continue;
      seenIds.add(item.sessionId);
      items.push(item);
    }
    return { items };
  } catch (error) {
    if (error instanceof PenglaiError) throw error;
    return { items: [], projectionError: error };
  }
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
      try {
        const raw = await ctx.agents.resume({ resumeSessionId: sessionId });
        if (isAgentHandle(raw)) handles.set(sessionId, raw);
        return unwrapAgent(raw);
      } catch (error) {
        const live = ctx.agents.get(sessionId) as DshAgentLike | undefined;
        if (live && isSessionAlreadyOwned(error)) return live;
        if (isSessionAlreadyOwned(error)) {
          throw new PenglaiError("DSH_UNAVAILABLE", "session is already owned by another handle");
        }
        throw error;
      }
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
      const listed = await listOfficialSessions(requiredController(ctx));
      if (listed.projectionError && listed.items.length === 0) {
        throw new PenglaiError("DSH_UNAVAILABLE", "official session list projection failed");
      }
      return listed.items.map((item) => {
        const projected = item.projections?.values?.title;
        return {
          id: item.sessionId,
          ...(typeof projected === "string" ? { title: projected } : {}),
        };
      });
    },
    async inspectSession(sessionId: string) {
      const controller = requiredController(ctx);
      try {
        const inspected = await controller.inspect(sessionId, new AbortController().signal);
        return { events: inspected.events ?? [] };
      } catch (error) {
        if (isSessionNotFound(error)) return undefined;
        if (isSessionAlreadyOwned(error)) {
          const live = ctx.agents?.get(sessionId) as DshAgentLike | undefined;
          if (live?.session) return { events: [...live.session.snapshotEvents()] };
          throw new PenglaiError("DSH_UNAVAILABLE", "session is already owned by another handle");
        }
        throw error;
      }
    },
    async createSession(workspaceIdentity: string, title?: string) {
      const controller = requiredController(ctx);
      const created = await controller.create({ workspaceId: workspaceIdentity });
      if (title?.trim()) await controller.rename({ sessionId: created.sessionId, title });
      return { id: created.sessionId };
    },
    async describeSessionModels(sessionId: string) {
      const controller = requiredController(ctx);
      const catalog = await controller.modelCatalog();
      const groups = catalog.groups.map((group) => ({
        id: group.id,
        name: group.name,
        models: group.models.map((entry) => ({ id: entry.id, name: entry.name })),
      }));
      const directory = (current: DshModelSelection, sessionExists: boolean, routable: boolean) => ({
        current,
        routable,
        sessionExists,
        groups,
      });
      const listed = await listOfficialSessions(controller);
      if (listed.projectionError && listed.items.length === 0) {
        throw new PenglaiError("DSH_UNAVAILABLE", "official session list projection failed");
      }
      let summary = listed.items.find((item) => item.sessionId === sessionId);
      if (!summary) {
        try {
          await controller.inspect(sessionId, new AbortController().signal);
        } catch (error) {
          if (isSessionNotFound(error)) {
            return directory(catalog.default, false, false);
          }
          throw new PenglaiError("DSH_UNAVAILABLE", "official session inspect failed while proving existence");
        }
      }
      const projection = summary?.projections?.values?.modelSelection;
      const projected = projection && typeof projection === "object"
        ? modelSelection((projection as Record<string, unknown>).next)
          ?? modelSelection((projection as Record<string, unknown>).lastUsed)
        : undefined;
      const current = projected ?? catalog.default;
      const routable = catalog.routableProviders.includes(current.provider) &&
        groups.some((group) => group.id === current.provider && group.models.some((entry) => entry.id === current.model));
      return directory(current, true, routable);
    },
    async selectSessionModel(sessionId, selection) {
      const result = await requiredController(ctx).selectModel({ sessionId, ...selection });
      return result.selected;
    },
  };
}
