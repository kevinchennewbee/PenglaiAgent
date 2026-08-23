import { createHash } from "node:crypto";
import { join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { resolveMnemonBinary } from "./mnemon-provider.js";
import { MnemonRunner } from "./runner.js";
import { MnemonAdapter } from "./adapter.js";
import { assertNotSecret } from "../trust/governance.js";
import type { DotGraph } from "./dot.js";
import { digestContent, MemoryJournal } from "./journal.js";

export function workspaceHash(workspaceId: string): string {
  return createHash("sha256").update(`penglai-workspace:${workspaceId}`).digest("hex");
}

export function personalDataDir(root: string): string {
  return join(root, "memory", "mnemon", "personal");
}

export function workspaceDataDir(root: string, workspaceId: string): string {
  return join(root, "memory", "mnemon", "workspaces", workspaceHash(workspaceId));
}

export interface MemoryHit {
  id: string;
  content: string;
  scope: "personal" | "workspace";
  workspaceId?: string;
}

export class MnemonMemoryService {
  readonly runner?: MnemonRunner;
  readonly personal?: MnemonAdapter;
  private readonly workspaces = new Map<string, MnemonAdapter>();
  private closed = false;
  readonly enabled: boolean;
  readonly degraded: boolean;
  readonly degradeReason?: string;
  readonly journal: MemoryJournal;

  constructor(
    private readonly root: string,
    opts: {
      readonly?: boolean;
      enabled?: boolean;
      binaryPath?: string;
      appRoot?: string;
      /** Test-only escape hatch for the deterministic fake Mnemon executable. */
      allowUnpinnedTestBinary?: boolean;
    } = {},
  ) {
    const binary = resolveMnemonBinary({
      ...(opts.binaryPath ? { explicitPath: opts.binaryPath } : {}),
      ...(opts.appRoot ? { appRoot: opts.appRoot } : {}),
      verifyHash: opts.allowUnpinnedTestBinary !== true,
    });
    this.enabled = opts.enabled !== false;
    this.journal = new MemoryJournal(join(root, "memory", "journal.sqlite3"));
    if (!binary) {
      this.degraded = true;
      this.degradeReason = "mnemon binary missing";
      return;
    }
    this.degraded = false;
    this.runner = new MnemonRunner(binary.path, opts.readonly === true);
    this.personal = new MnemonAdapter(this.runner, personalDataDir(root));
  }

  private workspace(workspaceId: string): MnemonAdapter {
    if (!this.runner) throw new PenglaiError("DSH_UNAVAILABLE", "mnemon binary missing");
    const existing = this.workspaces.get(workspaceId);
    if (existing) return existing;
    const adapter = new MnemonAdapter(this.runner, workspaceDataDir(this.root, workspaceId));
    this.workspaces.set(workspaceId, adapter);
    return adapter;
  }

  private requireEnabled(): MnemonAdapter {
    if (this.closed || !this.enabled) throw new PenglaiError("SECURITY_POLICY", "memory plugin disabled");
    if (this.degraded || !this.personal || !this.runner) {
      throw new PenglaiError("DSH_UNAVAILABLE", this.degradeReason ?? "mnemon binary missing");
    }
    return this.personal;
  }

  private adapterForKnownId(id: string, currentWorkspaceId?: string): {
    adapter: MnemonAdapter;
    scope: "personal" | "workspace";
    workspaceId?: string;
  } {
    const personal = this.requireEnabled();
    const row = this.journal.get(id);
    if (!row) throw new PenglaiError("UNAUTHORIZED", "memory id is not present in the Penglai journal");
    if (row.scope === "personal") return { adapter: personal, scope: "personal" };
    if (!row.workspaceId || row.workspaceId !== currentWorkspaceId) {
      throw new PenglaiError("UNAUTHORIZED", "memory id is outside the current official Workspace");
    }
    return { adapter: this.workspace(row.workspaceId), scope: "workspace", workspaceId: row.workspaceId };
  }

  async remember(input: { text: string; workspaceId?: string; cat?: string; tags?: string }) {
    const personal = this.requireEnabled();
    assertNotSecret(input.text);
    const adapter = input.workspaceId ? this.workspace(input.workspaceId) : personal;
    const remembered = await adapter.remember(input.text, {
      cat: input.cat ?? "fact",
      source: "user",
      ...(input.tags ? { tags: input.tags } : {}),
    });
    this.journal.upsert({
      id: remembered.id,
      scope: input.workspaceId ? "workspace" : "personal",
      workspaceId: input.workspaceId ?? null,
      content: input.text,
      contentDigest: digestContent(input.text),
      status: "committed",
      source: "user",
      tags: input.tags ?? "",
      createdAt: new Date().toISOString(),
      supersededBy: null,
    });
    return remembered;
  }

  async search(query: string, workspaceId?: string, includePersonal = false): Promise<MemoryHit[]> {
    const personal = this.requireEnabled();
    const hits: MemoryHit[] = [];
    if (workspaceId) {
      const rows = (await this.workspace(workspaceId).search(query)) as Array<{ id: string; content: string }>;
      hits.push(...rows.map((row) => ({ ...row, scope: "workspace" as const, workspaceId })));
    }
    if (includePersonal || !workspaceId) {
      const rows = (await personal.search(query)) as Array<{ id: string; content: string }>;
      hits.push(...rows.map((row) => ({ ...row, scope: "personal" as const })));
    }
    return hits;
  }

  async recall(query: string, workspaceId?: string) {
    const personal = this.requireEnabled();
    const adapter = workspaceId ? this.workspace(workspaceId) : personal;
    return adapter.recall(query);
  }

  async related(id: string, workspaceId?: string) {
    const { adapter } = this.adapterForKnownId(id, workspaceId);
    return adapter.related(id);
  }

  async why(id: string, workspaceId?: string) {
    const located = this.adapterForKnownId(id, workspaceId);
    const related = await located.adapter.related(id);
    const indexed = this.journal.get(id)!;
    return {
      id,
      content: indexed.content,
      scope: indexed.scope,
      related,
      source: indexed.source,
      contentDigest: indexed.contentDigest,
      status: indexed.status,
      recalledBecause: "journal",
      ...(located.workspaceId ? { workspaceId: located.workspaceId } : {}),
    };
  }

  async export(workspaceId?: string, includePersonal = false) {
    this.requireEnabled();
    const workspaceRows = workspaceId ? this.journal.listActive("workspace", workspaceId) : [];
    const personalRows = includePersonal || !workspaceId ? this.journal.listActive("personal") : [];
    return {
      schema: "penglai.memory.export.v1",
      exportedAt: new Date().toISOString(),
      includePersonal,
      rows: [...workspaceRows, ...personalRows],
      ...(workspaceId ? { workspaceId } : {}),
    };
  }

  async deleteScope(workspaceId?: string) {
    this.requireEnabled();
    const rows = workspaceId
      ? this.journal.listActive("workspace", workspaceId)
      : this.journal.listActive("personal");
    for (const row of rows) {
      await this.forget(row.id, workspaceId);
    }
    return { removed: rows.length };
  }

  async correct(oldId: string, text: string, workspaceId?: string) {
    const located = this.adapterForKnownId(oldId, workspaceId);
    const next = await this.remember({
      text,
      tags: `supersedes:${oldId}`,
      ...(located.workspaceId ? { workspaceId: located.workspaceId } : {}),
    });
    await located.adapter.link(next.id, oldId);
    this.journal.mark(oldId, "superseded", next.id);
    await located.adapter.forget(oldId);
    this.journal.mark(oldId, "forgotten", next.id);
    return next;
  }

  async forget(id: string, workspaceId?: string) {
    const { adapter } = this.adapterForKnownId(id, workspaceId);
    const result = await adapter.forget(id);
    this.journal.mark(id, "forgotten");
    return result;
  }

  async graph(workspaceId?: string, includePersonal = false): Promise<DotGraph> {
    const personal = this.requireEnabled();
    const adapter = workspaceId ? this.workspace(workspaceId) : personal;
    const graph = await adapter.vizDot();
    if (includePersonal && workspaceId) {
      const overlay = await personal.vizDot();
      return {
        nodes: [...graph.nodes, ...overlay.nodes].slice(0, 500),
        edges: [...graph.edges, ...overlay.edges].slice(0, 2000),
        truncated: graph.truncated || overlay.truncated,
      };
    }
    return graph;
  }

  async health() {
    if (this.degraded || !this.runner || !this.personal) {
      return {
        healthy: false,
        engine: "mnemon-cli",
        version: "unavailable",
        personalInsights: 0,
        reason: this.degradeReason ?? "mnemon binary missing",
      };
    }
    const version = await this.runner.version();
    const status = await this.personal.status().catch(() => ({ total_insights: 0, db_path: undefined as string | undefined }));
    return {
      healthy: !this.closed && this.enabled,
      engine: "mnemon-cli",
      version,
      personalInsights: status.total_insights ?? 0,
      dbPath: "db_path" in status ? status.db_path : undefined,
    };
  }

  close(): void {
    this.closed = true;
    this.journal.close();
  }

  resourceSnapshot() {
    return { workers: 0, sockets: 0, timers: 0, remotes: 0, db: this.closed ? 0 : 1, modelSessions: 0, audioHandles: 0 };
  }
}

/** @deprecated dual sqlite engine removed from the runtime path */
export const IsolatedMemoryEngine = MnemonMemoryService;
