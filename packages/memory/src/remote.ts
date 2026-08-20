import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError } from "@penglai/contracts";
import type { MemoryScope, MemoryWrite } from "./service.js";
import type { SopPromotion, SopReceipt } from "./index.js";

interface MemorySettingsHost {
  write(input: MemoryWrite, receipt?: string): { ok: true; id?: number; viaOfficialSkill?: boolean };
  list(scope: MemoryScope, workspaceId?: string): Array<{ id: number; text: string; workspaceId?: string | null }>;
  deleteScope(scope: MemoryScope, workspaceId?: string): number;
  promoteSop(input: SopPromotion): Promise<SopReceipt>;
}

interface WorkspaceRegistryLike {
  list(): Array<{ id: string; title?: string }>;
}

const scopes = new Set<MemoryScope>(["global", "workspace", "candidate"]);

export function createMemorySettingsApi(service: MemorySettingsHost, workspaceRegistry: WorkspaceRegistryLike) {
  const requireScope = (scope: MemoryScope) => {
    if (!scopes.has(scope)) throw new PenglaiError("INVALID_INPUT", "invalid memory scope");
  };
  const requireWorkspace = (workspaceId: string | undefined) => {
    if (!workspaceId || !workspaceRegistry.list().some((row) => row.id === workspaceId)) {
      throw new PenglaiError("INVALID_INPUT", "memory Workspace is not live");
    }
  };
  return {
    status(input: { scope: MemoryScope; workspaceId?: string }) {
      requireScope(input.scope);
      if (input.scope === "workspace") requireWorkspace(input.workspaceId);
      return {
        scope: input.scope,
        rows: service.list(input.scope, input.workspaceId),
        workspaces: workspaceRegistry.list().map((row) => ({ id: row.id, title: row.title ?? row.id })),
      };
    },
    write(input: MemoryWrite) {
      requireScope(input.scope);
      if (input.scope === "candidate") throw new PenglaiError("SECURITY_POLICY", "session candidates are written by the memory pipeline");
      if (typeof input.text !== "string" || !input.text.trim()) throw new PenglaiError("INVALID_INPUT", "memory text required");
      if (input.scope === "workspace") requireWorkspace(input.workspaceId);
      return service.write({
        scope: input.scope,
        text: input.text.trim(),
        ...(input.scope === "workspace" ? { workspaceId: input.workspaceId } : {}),
        ...(input.scope === "global" ? { ownerConfirmed: input.ownerConfirmed, visibleDiff: input.visibleDiff } : {}),
      }, "owner-settings");
    },
    deleteScope(input: { scope: MemoryScope; workspaceId?: string; ownerConfirmed: boolean }) {
      requireScope(input.scope);
      if (!input.ownerConfirmed) throw new PenglaiError("SECURITY_POLICY", "memory delete requires Owner confirmation");
      if (input.scope === "workspace") requireWorkspace(input.workspaceId);
      return { removed: service.deleteScope(input.scope, input.workspaceId) };
    },
    promoteSop(input: SopPromotion) { return service.promoteSop(input); },
  };
}

export class PenglaiMemoryRemote extends TypertRemoteService {
  constructor(ctx: Context, private readonly api: ReturnType<typeof createMemorySettingsApi>) { super(ctx, "penglaiMemorySettings"); }
  @Remote status(input: { scope: MemoryScope; workspaceId?: string }) { return this.api.status(input); }
  @Remote write(input: MemoryWrite) { return this.api.write(input); }
  @Remote deleteScope(input: { scope: MemoryScope; workspaceId?: string; ownerConfirmed: boolean }) { return this.api.deleteScope(input); }
  @Remote promoteSop(input: SopPromotion) { return this.api.promoteSop(input); }
}

export const TYPERT_REMOTE = { package: "@penglai/memory", descriptors: ["status", "write", "deleteScope", "promoteSop"] };
