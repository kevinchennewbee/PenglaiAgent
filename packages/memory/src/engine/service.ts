import { createHash } from "node:crypto";
import { join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { bundledMnemonBinary } from "./mnemon-provider.js";
import { MnemonRunner } from "./runner.js";
import { MnemonAdapter } from "./adapter.js";
import { assertNotSecret } from "../trust/governance.js";
import type { DotGraph } from "./dot.js";

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
  readonly runner: MnemonRunner;
  readonly personal: MnemonAdapter;
  private readonly workspaces = new Map<string, MnemonAdapter>();
  private closed = false;
  readonly enabled: boolean;

  constructor(
    private readonly root: string,
    opts: { readonly?: boolean; enabled?: boolean } = {},
  ) {
    const binary = bundledMnemonBinary();
    if (!binary) throw new PenglaiError("DSH_UNAVAILABLE", "mnemon binary missing");
    this.runner = new MnemonRunner(binary.path, opts.readonly === true);
    this.personal = new MnemonAdapter(this.runner, personalDataDir(root));
    this.enabled = opts.enabled !== false;
  }

  private workspace(workspaceId: string): MnemonAdapter {
    const existing = this.workspaces.get(workspaceId);
    if (existing) return existing;
    const adapter = new MnemonAdapter(this.runner, workspaceDataDir(this.root, workspaceId));
    this.workspaces.set(workspaceId, adapter);
    return adapter;
  }

  private requireEnabled(): void {
    if (this.closed || !this.enabled) throw new PenglaiError("SECURITY_POLICY", "memory plugin disabled");
  }

  async remember(input: { text: string; workspaceId?: string; cat?: string; tags?: string }) {
    this.requireEnabled();
    assertNotSecret(input.text);
    const adapter = input.workspaceId ? this.workspace(input.workspaceId) : this.personal;
    return adapter.remember(input.text, {
      cat: input.cat ?? "fact",
      source: "user",
      ...(input.tags ? { tags: input.tags } : {}),
    });
  }

  async search(query: string, workspaceId?: string, includePersonal = false): Promise<MemoryHit[]> {
    this.requireEnabled();
    const hits: MemoryHit[] = [];
    if (workspaceId) {
      const rows = (await this.workspace(workspaceId).search(query)) as Array<{ id: string; content: string }>;
      hits.push(...rows.map((row) => ({ ...row, scope: "workspace" as const, workspaceId })));
    }
    if (includePersonal || !workspaceId) {
      const rows = (await this.personal.search(query)) as Array<{ id: string; content: string }>;
      hits.push(...rows.map((row) => ({ ...row, scope: "personal" as const })));
    }
    return hits;
  }

  async recall(query: string, workspaceId?: string) {
    this.requireEnabled();
    const adapter = workspaceId ? this.workspace(workspaceId) : this.personal;
    return adapter.recall(query);
  }

  async related(id: string, workspaceId?: string) {
    this.requireEnabled();
    const adapter = workspaceId ? this.workspace(workspaceId) : this.personal;
    return adapter.related(id);
  }

  async why(id: string, workspaceId?: string) {
    this.requireEnabled();
    const related = await this.related(id, workspaceId);
    const hits = await this.search(id, workspaceId, true);
    const hit = hits.find((row) => row.id === id);
    return {
      id,
      content: hit?.content ?? "",
      scope: hit?.scope ?? (workspaceId ? "workspace" : "personal"),
      related,
      source: "mnemon",
      recalledBecause: hit ? "search-hit" : "related-lookup",
      ...(workspaceId ? { workspaceId } : {}),
    };
  }

  async export(workspaceId?: string, includePersonal = false) {
    this.requireEnabled();
    const hits = await this.search(".", workspaceId, includePersonal);
    const graph = await this.graph(workspaceId, includePersonal);
    return {
      exportedAt: new Date().toISOString(),
      includePersonal,
      hits,
      graph,
      ...(workspaceId ? { workspaceId } : {}),
    };
  }

  async correct(oldId: string, text: string, workspaceId?: string) {
    this.requireEnabled();
    const next = await this.remember({
      text,
      tags: `supersedes:${oldId}`,
      ...(workspaceId ? { workspaceId } : {}),
    });
    const adapter = workspaceId ? this.workspace(workspaceId) : this.personal;
    await adapter.link(next.id, oldId);
    await adapter.forget(oldId);
    return next;
  }

  async forget(id: string, workspaceId?: string) {
    this.requireEnabled();
    const adapter = workspaceId ? this.workspace(workspaceId) : this.personal;
    return adapter.forget(id);
  }

  async graph(workspaceId?: string, includePersonal = false): Promise<DotGraph> {
    this.requireEnabled();
    const adapter = workspaceId ? this.workspace(workspaceId) : this.personal;
    const graph = await adapter.vizDot();
    if (includePersonal && workspaceId) {
      const personal = await this.personal.vizDot();
      return {
        nodes: [...graph.nodes, ...personal.nodes].slice(0, 500),
        edges: [...graph.edges, ...personal.edges].slice(0, 2000),
        truncated: graph.truncated || personal.truncated,
      };
    }
    return graph;
  }

  async health() {
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
  }

  resourceSnapshot() {
    return { workers: 0, sockets: 0, timers: 0, remotes: 0, db: this.closed ? 0 : 1, modelSessions: 0, audioHandles: 0 };
  }
}

/** @deprecated dual sqlite engine removed from the runtime path */
export const IsolatedMemoryEngine = MnemonMemoryService;
