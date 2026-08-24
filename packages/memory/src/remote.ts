import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError } from "@penglai/contracts";
import type { MemoryScope, MemoryWrite } from "./service.js";
import type { SopPromotion, SopReceipt } from "./index.js";

interface MemorySettingsHost {
  write?(input: MemoryWrite, receipt?: string): { ok: true; id?: number; viaOfficialSkill?: boolean };
  remember?(input: { text: string; workspaceId?: string }): Promise<{ id: string }>;
  search?(query: string, workspaceId?: string): Promise<Array<{ id: string; content?: string; text?: string }>>;
  forget?(id: string, workspaceId?: string, proof?: { actionId: string; receipt: string }): Promise<unknown>;
  deleteKnown?(workspaceId?: string): Promise<{ removed: number }>;
  why?(id: string, workspaceId?: string): Promise<unknown>;
  correct?(oldId: string, text: string, workspaceId?: string, proof?: { actionId: string; receipt: string }): Promise<unknown>;
  graph?(workspaceId?: string, includePersonal?: boolean): Promise<unknown>;
  export?(workspaceId?: string, includePersonal?: boolean): Promise<unknown>;
  importPreview?(): Promise<unknown>;
  importConfirm?(): Promise<unknown>;
  list?(scope: MemoryScope, workspaceId?: string): Array<{ id: string | number; text: string; workspaceId?: string | null }>;
  count?(workspaceId?: string): { workspace: number; personal: number; pending: number; mode: string };
  acceptCandidate?(input: { candidateId: string; actionId: string; receipt: string; personal?: boolean }): unknown;
  rejectCandidate?(input: { candidateId: string }): unknown;
  setMemoryMode?(mode: string): unknown;
  proposeAction?(input: { action: string; objectId: string; workspaceId?: string; sessionId?: string }): { actionId: string; action: string };
  deleteScope?(scope: MemoryScope, workspaceId?: string): number;
  promoteSop(input: SopPromotion): Promise<SopReceipt>;
}

interface WorkspaceRegistryLike {
  list(): Array<{ id: string; title?: string }>;
}

interface MemorySourcesSettingsApi {
  status(): unknown;
  ingestCapability(input: { capabilityRef: string; scope: "global" | "workspace"; workspaceId?: string }): unknown;
  reindex(input: { root: string }): unknown;
  revoke(input: { root: string; ownerConfirmed: boolean }): unknown;
  search(input: { query: string; workspaceId?: string }): unknown;
}

const scopes = new Set<MemoryScope>(["global", "workspace", "candidate"]);

export function createMemorySettingsApi(
  service: MemorySettingsHost,
  workspaceRegistry: WorkspaceRegistryLike,
  sources?: MemorySourcesSettingsApi,
) {
  const requireScope = (scope: MemoryScope) => {
    if (!scopes.has(scope)) throw new PenglaiError("INVALID_INPUT", "invalid memory scope");
  };
  const requireWorkspace = (workspaceId: string | undefined) => {
    if (!workspaceId || !workspaceRegistry.list().some((row) => row.id === workspaceId)) {
      throw new PenglaiError("INVALID_INPUT", "memory Workspace is not live");
    }
  };
  const requireSources = () => {
    if (!sources) throw new PenglaiError("DSH_UNAVAILABLE", "memory sources unavailable");
    return sources;
  };
  return {
    async status(input: { scope: MemoryScope; workspaceId?: string }) {
      requireScope(input.scope);
      if (input.scope === "workspace" || input.scope === "candidate") requireWorkspace(input.workspaceId);
      const rows = service.list ? await Promise.resolve(service.list(input.scope, input.workspaceId)) : [];
      const counts = service.count?.(input.workspaceId);
      return {
        scope: input.scope,
        rows,
        workspaces: workspaceRegistry.list().map((row) => ({ id: row.id, title: row.title ?? row.id })),
        ...(counts ? { counts } : {}),
      };
    },
    async setMode(input: { mode: string }) {
      if (!service.setMemoryMode) throw new PenglaiError("DSH_UNAVAILABLE", "memory mode unavailable");
      return { mode: service.setMemoryMode(input.mode) };
    },
    async proposeAction(input: { action: string; objectId: string; workspaceId?: string; sessionId?: string }) {
      if (!service.proposeAction) throw new PenglaiError("DSH_UNAVAILABLE", "memory owner broker unavailable");
      return service.proposeAction(input);
    },
    async acceptCandidate(input: { candidateId: string; actionId: string; receipt: string; personal?: boolean }) {
      if (!service.acceptCandidate) throw new PenglaiError("DSH_UNAVAILABLE", "memory candidates unavailable");
      if (!input.receipt) throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      return service.acceptCandidate({
        candidateId: input.candidateId,
        actionId: input.actionId,
        receipt: input.receipt,
        ...(input.personal ? { personal: true } : {}),
      });
    },
    async rejectCandidate(input: { candidateId: string }) {
      if (!service.rejectCandidate) throw new PenglaiError("DSH_UNAVAILABLE", "memory candidates unavailable");
      return service.rejectCandidate({ candidateId: input.candidateId });
    },
    ingestCurator() {
      throw new PenglaiError("SECURITY_POLICY", "memory curator is host-only");
    },
    async write(input: MemoryWrite) {
      requireScope(input.scope);
      if (input.scope === "candidate") throw new PenglaiError("SECURITY_POLICY", "session candidates are written by the memory pipeline");
      if (typeof input.text !== "string" || !input.text.trim()) throw new PenglaiError("INVALID_INPUT", "memory text required");
      if (input.scope === "global" && (!input.ownerConfirmed || !input.visibleDiff)) {
        throw new PenglaiError("SECURITY_POLICY", "global/SOP write requires visible diff and Owner confirm");
      }
      if (input.scope === "workspace") requireWorkspace(input.workspaceId);
      if (service.remember) {
        return service.remember({
          text: input.text.trim(),
          ...(input.scope === "workspace" ? { workspaceId: input.workspaceId } : {}),
        });
      }
      if (!service.write) throw new PenglaiError("DSH_UNAVAILABLE", "memory write unavailable");
      return service.write({
        scope: input.scope,
        text: input.text.trim(),
        ...(input.scope === "workspace" ? { workspaceId: input.workspaceId } : {}),
        ...(input.scope === "global" ? { ownerConfirmed: input.ownerConfirmed, visibleDiff: input.visibleDiff } : {}),
      }, "owner-settings");
    },
    async deleteScope(input: { scope: MemoryScope; workspaceId?: string; ownerConfirmed?: boolean; actionId?: string; receipt?: string }) {
      requireScope(input.scope);
      if (!input.actionId || !input.receipt) throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      if (input.scope === "workspace") requireWorkspace(input.workspaceId);
      if (service.deleteKnown) {
        return service.deleteKnown(input.scope === "workspace" ? input.workspaceId : undefined);
      }
      return { removed: service.deleteScope?.(input.scope, input.workspaceId) ?? 0 };
    },
    promoteSop(input: SopPromotion) { return service.promoteSop(input); },
    async why(input: { id: string; workspaceId?: string }) {
      if (!service.why) throw new PenglaiError("DSH_UNAVAILABLE", "memory why unavailable");
      return service.why(input.id, input.workspaceId);
    },
    async correct(input: { id: string; text: string; workspaceId?: string; actionId?: string; receipt?: string }) {
      if (!service.correct) throw new PenglaiError("DSH_UNAVAILABLE", "memory correct unavailable");
      if (!input.text.trim()) throw new PenglaiError("INVALID_INPUT", "memory text required");
      if (!input.actionId || !input.receipt) throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      return service.correct(input.id, input.text.trim(), input.workspaceId, { actionId: input.actionId, receipt: input.receipt });
    },
    async forget(input: { id: string; workspaceId?: string; ownerConfirmed?: boolean; actionId?: string; receipt?: string }) {
      if (!input.actionId || !input.receipt) throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      if (!service.forget) throw new PenglaiError("DSH_UNAVAILABLE", "memory forget unavailable");
      return service.forget(input.id, input.workspaceId, { actionId: input.actionId, receipt: input.receipt });
    },
    async graph(input: { workspaceId?: string; includePersonal?: boolean }) {
      if (!service.graph) throw new PenglaiError("DSH_UNAVAILABLE", "memory graph unavailable");
      if (input.workspaceId) requireWorkspace(input.workspaceId);
      return service.graph(input.workspaceId, input.includePersonal === true);
    },
    async export(input: { workspaceId?: string; includePersonal?: boolean }) {
      if (!service.export) throw new PenglaiError("DSH_UNAVAILABLE", "memory export unavailable");
      return service.export(input.workspaceId, input.includePersonal === true);
    },
    async importPreview() {
      if (!service.importPreview) throw new PenglaiError("DSH_UNAVAILABLE", "memory import preview unavailable");
      return service.importPreview();
    },
    async importConfirm(input: { ownerConfirmed?: boolean; actionId?: string; receipt?: string }) {
      if (!input.actionId || !input.receipt) throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      if (!service.importConfirm) throw new PenglaiError("DSH_UNAVAILABLE", "memory import unavailable");
      return service.importConfirm();
    },
    sourcesStatus() { return requireSources().status(); },
    sourcesIngestCapability(input: { capabilityRef: string; scope: "global" | "workspace"; workspaceId?: string }) {
      return requireSources().ingestCapability(input);
    },
    sourcesReindex(input: { root: string }) { return requireSources().reindex(input); },
    sourcesRevoke(input: { root: string; ownerConfirmed: boolean }) { return requireSources().revoke(input); },
    sourcesSearch(input: { query: string; workspaceId?: string }) { return requireSources().search(input); },
  };
}

export class PenglaiMemoryRemote extends TypertRemoteService {
  constructor(ctx: Context, private readonly api: ReturnType<typeof createMemorySettingsApi>) { super(ctx, "penglaiMemorySettings"); }
  @Remote status(input: { scope: MemoryScope; workspaceId?: string }) { return this.api.status(input); }
  @Remote setMode(input: { mode: string }) { return this.api.setMode(input); }
  @Remote proposeAction(input: { action: string; objectId: string; workspaceId?: string; sessionId?: string }) { return this.api.proposeAction(input); }
  @Remote acceptCandidate(input: { candidateId: string; actionId: string; receipt: string; personal?: boolean }) { return this.api.acceptCandidate(input); }
  @Remote rejectCandidate(input: { candidateId: string }) { return this.api.rejectCandidate(input); }
  @Remote write(input: MemoryWrite) { return this.api.write(input); }
  @Remote deleteScope(input: { scope: MemoryScope; workspaceId?: string; actionId?: string; receipt?: string }) { return this.api.deleteScope(input); }
  @Remote promoteSop(input: SopPromotion) { return this.api.promoteSop(input); }
  @Remote why(input: { id: string; workspaceId?: string }) { return this.api.why(input); }
  @Remote correct(input: { id: string; text: string; workspaceId?: string; actionId?: string; receipt?: string }) { return this.api.correct(input); }
  @Remote forget(input: { id: string; workspaceId?: string; actionId?: string; receipt?: string }) { return this.api.forget(input); }
  @Remote graph(input: { workspaceId?: string; includePersonal?: boolean }) { return this.api.graph(input); }
  @Remote export(input: { workspaceId?: string; includePersonal?: boolean }) { return this.api.export(input); }
  @Remote importPreview() { return this.api.importPreview(); }
  @Remote importConfirm(input: { actionId?: string; receipt?: string }) { return this.api.importConfirm(input); }
  @Remote sourcesStatus() { return this.api.sourcesStatus(); }
  @Remote sourcesIngestCapability(input: { capabilityRef: string; scope: "global" | "workspace"; workspaceId?: string }) { return this.api.sourcesIngestCapability(input); }
  @Remote sourcesReindex(input: { root: string }) { return this.api.sourcesReindex(input); }
  @Remote sourcesRevoke(input: { root: string; ownerConfirmed: boolean }) { return this.api.sourcesRevoke(input); }
  @Remote sourcesSearch(input: { query: string; workspaceId?: string }) { return this.api.sourcesSearch(input); }
}

export const TYPERT_REMOTE = {
  package: "@penglai/memory",
  descriptors: [
    "status", "write", "deleteScope", "promoteSop", "why", "correct", "forget", "graph", "export",
    "importPreview", "importConfirm", "setMode", "proposeAction", "acceptCandidate", "rejectCandidate",
    "sourcesStatus", "sourcesIngestCapability", "sourcesReindex",
    "sourcesRevoke", "sourcesSearch",
  ],
};
