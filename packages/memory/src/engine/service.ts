import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import {
  IsolatedRecordStore,
  ledgerPath,
  newRecordId,
  personalDbPath,
  runtimeUserPath,
  runtimeWorkspacePath,
  workspaceDbPath,
} from "../scope/workspace-store.js";
import {
  assertNotPrivilegeClaim,
  assertNotSecret,
  digestText,
  GovernanceLedger,
} from "../trust/governance.js";
import type { MemoryRecord, MemoryScopeRef, MemoryWhy } from "./protocol.js";
import { PROMPT_TOKEN_BUDGET } from "./protocol.js";
import { projectGraph } from "../graph/projection.js";
import type { MemoryGraph } from "../graph/model.js";
import { exportJson } from "../export/json.js";
import { exportMarkdown } from "../export/markdown.js";
import { bundledMnemonBinary } from "./mnemon-provider.js";
import { MnemonProcessSupervisor } from "./process-supervisor.js";

export interface ExplicitRemember {
  text: string;
  workspaceId?: string;
  type?: MemoryRecord["type"];
}

export interface MemoryProposal {
  text: string;
  workspaceId?: string;
  locator: string;
  digest: string;
}

export class IsolatedMemoryEngine {
  readonly personal: IsolatedRecordStore;
  readonly ledger: GovernanceLedger;
  readonly supervisor: MnemonProcessSupervisor;
  private readonly workspaces = new Map<string, IsolatedRecordStore>();
  private closed = false;

  constructor(private readonly root: string) {
    this.personal = new IsolatedRecordStore(personalDbPath(root));
    this.ledger = new GovernanceLedger(ledgerPath(root));
    this.supervisor = new MnemonProcessSupervisor(bundledMnemonBinary()?.path);
  }

  private workspaceStore(workspaceId: string): IsolatedRecordStore {
    const existing = this.workspaces.get(workspaceId);
    if (existing) return existing;
    const store = new IsolatedRecordStore(workspaceDbPath(this.root, workspaceId));
    this.workspaces.set(workspaceId, store);
    return store;
  }

  private storeFor(scope: MemoryScopeRef): IsolatedRecordStore {
    return scope.kind === "personal" ? this.personal : this.workspaceStore(scope.workspaceId);
  }

  private projectRuntime(scope: MemoryScopeRef, records: MemoryRecord[]): void {
    const path = scope.kind === "personal" ? runtimeUserPath(this.root) : runtimeWorkspacePath(this.root, scope.workspaceId);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const body = records
      .filter((row) => row.status === "active")
      .map((row) => `- ${row.text}`)
      .join("\n");
    writeFileSync(path, `# memory\n${body}\n`, { mode: 0o600 });
  }

  rememberExplicit(input: ExplicitRemember, actor: string): MemoryRecord {
    assertNotSecret(input.text);
    const scope: MemoryScopeRef = input.workspaceId
      ? { kind: "workspace", workspaceId: input.workspaceId }
      : { kind: "personal" };
    const record = this.storeFor(scope).insert({
      id: newRecordId(),
      type: input.type ?? (input.workspaceId ? "project" : "profile"),
      scope,
      status: "active",
      text: input.text,
      source: { kind: "user", locator: actor, digest: digestText(input.text) },
      observedAt: new Date().toISOString(),
      authority: "owner-explicit",
      sensitivity: "normal",
    });
    this.ledger.append("remember", record.id, record.source.digest);
    this.projectRuntime(scope, this.storeFor(scope).listActive());
    return record;
  }

  propose(input: MemoryProposal): MemoryRecord {
    assertNotSecret(input.text);
    const quarantined = assertNotPrivilegeClaim(input.text);
    const scope: MemoryScopeRef = input.workspaceId
      ? { kind: "workspace", workspaceId: input.workspaceId }
      : { kind: "personal" };
    const record = this.storeFor(scope).insert({
      id: newRecordId(),
      type: quarantined ? "source" : "preference",
      scope,
      status: quarantined ? "quarantined" : "candidate",
      text: input.text,
      source: { kind: "turn", locator: input.locator, digest: input.digest },
      observedAt: new Date().toISOString(),
      authority: "agent-proposed",
      sensitivity: "normal",
    });
    this.ledger.append(quarantined ? "quarantine" : "propose", record.id, input.digest);
    return record;
  }

  search(query: string, workspaceId?: string): MemoryRecord[] {
    const personal = this.personal.activeSearch(query);
    const workspace = workspaceId ? this.workspaceStore(workspaceId).activeSearch(query) : [];
    return [...personal, ...workspace].slice(0, 200);
  }

  graph(workspaceId?: string): MemoryGraph {
    const records = [
      ...this.personal.listAll(),
      ...(workspaceId ? this.workspaceStore(workspaceId).listAll() : []),
    ];
    return projectGraph(records);
  }

  totalGraphReadonly(): MemoryGraph {
    return projectGraph(this.personal.listAll());
  }

  why(id: string, workspaceId?: string): MemoryWhy {
    const record =
      this.personal.getByRecordId(id) ??
      (workspaceId ? this.workspaceStore(workspaceId).getByRecordId(id) : undefined);
    if (!record) throw new PenglaiError("INVALID_INPUT", "memory not found");
    if (record.scope.kind === "workspace" && workspaceId && record.scope.workspaceId !== workspaceId) {
      throw new PenglaiError("SECURITY_POLICY", "memory workspace scope isolation");
    }
    return { id: record.id, text: record.text, status: record.status, source: record.source, authority: record.authority };
  }

  supersede(oldId: string, next: ExplicitRemember, workspaceId?: string): MemoryRecord {
    const old =
      this.personal.getByRecordId(oldId) ??
      (workspaceId ? this.workspaceStore(workspaceId).getByRecordId(oldId) : undefined);
    if (!old) throw new PenglaiError("INVALID_INPUT", "memory not found");
    this.storeFor(old.scope).setStatus(old.id, "superseded");
    const created = this.rememberExplicit(next, "owner-correction");
    this.storeFor(created.scope).db
      .prepare("UPDATE memory_records SET supersedes_id = ? WHERE record_id = ?")
      .run(old.id, created.id);
    this.ledger.append("supersede", created.id, old.id);
    return { ...created, supersedesId: old.id };
  }

  forget(id: string, workspaceId?: string): { id: string; status: "revoked" } {
    const record =
      this.personal.getByRecordId(id) ??
      (workspaceId ? this.workspaceStore(workspaceId).getByRecordId(id) : undefined);
    if (!record) throw new PenglaiError("INVALID_INPUT", "memory not found");
    if (record.scope.kind === "workspace" && workspaceId && record.scope.workspaceId !== workspaceId) {
      throw new PenglaiError("SECURITY_POLICY", "memory workspace scope isolation");
    }
    this.storeFor(record.scope).setStatus(id, "revoked");
    this.ledger.append("forget", id, record.source.digest);
    this.projectRuntime(record.scope, this.storeFor(record.scope).listActive());
    return { id, status: "revoked" };
  }

  export(scope: MemoryScopeRef, format: "markdown" | "json"): { bytes: Buffer; pathHint: string } {
    const records = this.storeFor(scope).listAll();
    const text = format === "json" ? exportJson(scope, records) : exportMarkdown(scope, records);
    return { bytes: Buffer.from(text), pathHint: format === "json" ? "memory.json" : "MEMORY.md" };
  }

  importCommit(records: MemoryRecord[]): number {
    let n = 0;
    for (const row of records) {
      assertNotSecret(row.text);
      this.storeFor(row.scope).insert({ ...row, id: newRecordId() });
      n += 1;
    }
    return n;
  }

  promptBudget(): { maxChars: number } {
    return { maxChars: PROMPT_TOKEN_BUDGET * 4 };
  }

  health() {
    const binary = bundledMnemonBinary();
    const process = this.supervisor.health();
    return {
      healthy: !this.closed,
      engine: binary ? "mnemon-binary" : "sqlite-mnemon-store",
      personalDb: this.personal.path,
      autoPrune: this.ledger.autoPruneEnabled(),
      binaryPresent: process.binaryPresent,
      degraded: process.degraded,
      ...(process.reason ? { reason: process.reason } : {}),
    };
  }

  failOpenSearch(query: string, workspaceId?: string): MemoryRecord[] {
    try {
      return this.search(query, workspaceId);
    } catch (error) {
      this.supervisor.markCrash(error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.supervisor.drainAndStop();
    this.personal.close();
    for (const store of this.workspaces.values()) store.close();
    this.ledger.close();
  }

  resourceSnapshot() {
    return {
      ...this.supervisor.resourceSnapshot(),
      remotes: 0,
      db: this.closed ? 0 : 1 + this.workspaces.size,
      modelSessions: 0,
      audioHandles: 0,
    };
  }
}
