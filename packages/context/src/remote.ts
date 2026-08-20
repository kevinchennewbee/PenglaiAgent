import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError } from "@penglai/contracts";
import type { ContextGrant } from "./service.js";
import { consumeContextGrantCapability } from "./grant-capability.js";

interface ContextSettingsHost {
  ingest(grant: ContextGrant): { scanned: number; indexed: number; failed: number; skipped: number };
  search(query: string, workspaceId?: string): unknown;
  revokeRoot(root: string): { deletedDerived: boolean; sourceUntouched: true };
  exportMetadata(): {
    schema: 1;
    grants: Array<{ root: string; scope: "global" | "workspace"; workspaceId: string | null; revision: number }>;
    documents: Array<{ path: string; root: string; digest: string; revision: number }>;
  };
}

interface WorkspaceRegistryLike {
  list(): Array<{ id: string; title?: string; path?: string }>;
}

export function createContextSettingsApi(
  service: ContextSettingsHost,
  userData: string,
  workspaceRegistry: WorkspaceRegistryLike,
) {
  const status = () => {
    const metadata = service.exportMetadata();
    return {
      schema: metadata.schema,
      grants: metadata.grants.map((grant) => ({
        ...grant,
        documents: metadata.documents.filter((doc) => doc.root === grant.root).length,
      })),
      workspaces: workspaceRegistry.list().map((workspace) => ({ id: workspace.id, title: workspace.title ?? workspace.id })),
    };
  };
  return {
    status,
    ingestCapability(input: {
      capabilityRef: string;
      scope: "global" | "workspace";
      workspaceId?: string;
    }) {
      if (input.scope !== "global" && input.scope !== "workspace") {
        throw new PenglaiError("INVALID_INPUT", "invalid context scope");
      }
      if (input.scope === "workspace" && !workspaceRegistry.list().some((row) => row.id === input.workspaceId)) {
        throw new PenglaiError("INVALID_INPUT", "context Workspace is not live");
      }
      const realPath = consumeContextGrantCapability(userData, input.capabilityRef);
      return service.ingest({
        scope: input.scope,
        ...(input.scope === "workspace" ? { workspaceId: input.workspaceId } : {}),
        requestedPath: realPath,
        realPath,
      });
    },
    reindex(input: { root: string }) {
      const grant = service.exportMetadata().grants.find((row) => row.root === input.root);
      if (!grant) throw new PenglaiError("UNAUTHORIZED", "context grant is not active");
      return service.ingest({
        scope: grant.scope,
        ...(grant.scope === "workspace" && grant.workspaceId ? { workspaceId: grant.workspaceId } : {}),
        requestedPath: grant.root,
        realPath: grant.root,
      });
    },
    revoke(input: { root: string; ownerConfirmed: boolean }) {
      if (!input.ownerConfirmed) throw new PenglaiError("SECURITY_POLICY", "context revoke requires Owner confirmation");
      if (!service.exportMetadata().grants.some((row) => row.root === input.root)) {
        throw new PenglaiError("UNAUTHORIZED", "context grant is not active");
      }
      return service.revokeRoot(input.root);
    },
    search(input: { query: string; workspaceId?: string }) {
      if (typeof input.query !== "string" || !input.query.trim()) throw new PenglaiError("INVALID_INPUT", "context query required");
      return service.search(input.query, input.workspaceId);
    },
  };
}

export class PenglaiContextRemote extends TypertRemoteService {
  constructor(ctx: Context, private readonly api: ReturnType<typeof createContextSettingsApi>) {
    super(ctx, "penglaiContextSettings");
  }

  @Remote status() { return this.api.status(); }
  @Remote ingestCapability(input: Parameters<ReturnType<typeof createContextSettingsApi>["ingestCapability"]>[0]) { return this.api.ingestCapability(input); }
  @Remote reindex(input: { root: string }) { return this.api.reindex(input); }
  @Remote revoke(input: { root: string; ownerConfirmed: boolean }) { return this.api.revoke(input); }
  @Remote search(input: { query: string; workspaceId?: string }) { return this.api.search(input); }
}

export const TYPERT_REMOTE = { package: "@penglai/context", descriptors: ["status", "ingestCapability", "reindex", "revoke", "search"] };
