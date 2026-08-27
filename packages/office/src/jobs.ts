import { createHash, randomUUID } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import type { OfficeFormat } from "./formats.js";
import type { OfficeOperation } from "./operations.js";

export type OfficeJobState =
  | "SELECTED"
  | "INSPECTED"
  | "PLAN_READY"
  | "PREVIEW_READY"
  | "OWNER_APPROVED"
  | "STAGED"
  | "COMMITTED"
  | "VERIFIED"
  | "FAILED"
  | "UNDO_READY"
  | "UNDONE"
  | "DISCARDED"
  | "CANCELLED";

export const OFFICE_JOB_LIMITS = {
  maxConcurrent: 32,
  maxRetained: 256,
  ttlMs: 30 * 60 * 1000,
} as const;

export type OfficeJobLimits = typeof OFFICE_JOB_LIMITS;

const IN_FLIGHT: ReadonlySet<OfficeJobState> = new Set([
  "SELECTED",
  "INSPECTED",
  "PLAN_READY",
  "PREVIEW_READY",
  "OWNER_APPROVED",
  "STAGED",
]);

export interface OfficeJobRecord {
  id: string;
  format: OfficeFormat;
  state: OfficeJobState;
  bytes: Buffer;
  sourceBytes: Buffer;
  text: string;
  parts: string[];
  warnings: string[];
  workspaceId?: string;
  sessionId?: string;
  routeId?: string;
  attachmentHandle?: string;
  artifactId?: string;
  parentArtifactId?: string;
  resultArtifactId?: string;
  sourcePath?: string;
  destPath?: string;
  digest: string;
  sourceDigest: string;
  previewResultDigest: string;
  backupRevision: number;
  lastBackupName?: string;
  ops: OfficeOperation[];
  opsDigest: string;
  receipt?: string;
  backupBytes?: Buffer;
  stagedBytes?: Buffer;
  resultDigest?: string;
  events: Array<{ at: number; state: OfficeJobState; note: string }>;
}

function wipeBuffer(buf?: Buffer): void {
  buf?.fill(0);
}

function wipeJob(job: OfficeJobRecord): void {
  wipeBuffer(job.bytes);
  wipeBuffer(job.sourceBytes);
  wipeBuffer(job.backupBytes);
  wipeBuffer(job.stagedBytes);
  job.text = "";
  job.parts = [];
}

function lastTouched(job: OfficeJobRecord): number {
  return job.events.at(-1)?.at ?? 0;
}

export class OfficeJobStore {
  private readonly jobs = new Map<string, OfficeJobRecord>();
  private readonly limits: OfficeJobLimits;
  private exitHooked = false;

  constructor(limits: OfficeJobLimits = OFFICE_JOB_LIMITS) {
    this.limits = limits;
  }

  private hookProcessExit(): void {
    if (this.exitHooked) return;
    this.exitHooked = true;
    process.once("exit", () => {
      this.wipeAll();
    });
  }

  private sweepExpired(now = Date.now()): void {
    for (const [id, job] of this.jobs) {
      if (now - lastTouched(job) > this.limits.ttlMs) {
        wipeJob(job);
        this.jobs.delete(id);
      }
    }
  }

  private inFlightCount(): number {
    let n = 0;
    for (const job of this.jobs.values()) {
      if (IN_FLIGHT.has(job.state)) n += 1;
    }
    return n;
  }

  private evictOldestRetained(): boolean {
    let oldest: OfficeJobRecord | undefined;
    for (const job of this.jobs.values()) {
      if (IN_FLIGHT.has(job.state)) continue;
      if (!oldest || lastTouched(job) < lastTouched(oldest)) oldest = job;
    }
    if (!oldest) return false;
    wipeJob(oldest);
    this.jobs.delete(oldest.id);
    return true;
  }

  private admit(): void {
    this.hookProcessExit();
    this.sweepExpired();
    while (this.jobs.size >= this.limits.maxRetained) {
      if (!this.evictOldestRetained()) {
        throw new PenglaiError("SECURITY_POLICY", "OFFICE_JOB_RETAINED_LIMIT");
      }
    }
    if (this.inFlightCount() >= this.limits.maxConcurrent) {
      throw new PenglaiError("SECURITY_POLICY", "OFFICE_JOB_CONCURRENT_LIMIT");
    }
  }

  create(input: {
    format: OfficeFormat;
    bytes: Buffer;
    text: string;
    parts?: string[];
    warnings?: string[];
    workspaceId?: string;
    sessionId?: string;
    routeId?: string;
    attachmentHandle?: string;
    sourcePath?: string;
    destPath?: string;
    ops?: OfficeOperation[];
  }): OfficeJobRecord {
    this.admit();
    const sourceDigest = digestBytes(input.bytes);
    const ops = input.ops ?? [];
    const job: OfficeJobRecord = {
      id: `office-${randomUUID()}`,
      format: input.format,
      state: "INSPECTED",
      bytes: Buffer.from(input.bytes),
      sourceBytes: Buffer.from(input.bytes),
      text: input.text,
      parts: input.parts ?? [],
      warnings: input.warnings ?? [],
      digest: sourceDigest,
      sourceDigest,
      previewResultDigest: sourceDigest,
      backupRevision: 0,
      ops,
      opsDigest: digestOps(ops),
      events: [{ at: Date.now(), state: "INSPECTED", note: "inspect" }],
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.routeId ? { routeId: input.routeId } : {}),
      ...(input.attachmentHandle ? { attachmentHandle: input.attachmentHandle } : {}),
      ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
      ...(input.destPath ? { destPath: input.destPath } : {}),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): OfficeJobRecord {
    this.sweepExpired();
    const job = this.jobs.get(id);
    if (!job) throw new PenglaiError("INVALID_INPUT", "office job not found");
    return job;
  }

  setState(id: string, state: OfficeJobState, note = ""): OfficeJobRecord {
    const job = this.get(id);
    job.state = state;
    job.events.push({ at: Date.now(), state, note });
    return job;
  }

  discard(id: string): void {
    const job = this.get(id);
    this.jobs.delete(id);
    job.state = "DISCARDED";
    wipeJob(job);
  }

  cancel(id: string): void {
    const job = this.get(id);
    this.jobs.delete(id);
    job.state = "CANCELLED";
    wipeJob(job);
  }

  stats(): { size: number; inFlight: number } {
    this.sweepExpired();
    return { size: this.jobs.size, inFlight: this.inFlightCount() };
  }

  wipeAll(): void {
    for (const job of this.jobs.values()) wipeJob(job);
    this.jobs.clear();
  }
}

const defaultStore = new OfficeJobStore();

export function digestBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function digestOps(ops: OfficeOperation[]): string {
  return createHash("sha256").update(JSON.stringify(ops)).digest("hex");
}

export function officeBackupName(input: {
  operationId: string;
  revision: number;
  digest: string;
  kind: "bak" | "undo";
}): string {
  if (!/^office-[0-9a-f-]{36}$/i.test(input.operationId)) {
    throw new PenglaiError("SECURITY_POLICY", "office backup operation id");
  }
  if (!Number.isInteger(input.revision) || input.revision < 1 || input.revision > 1_000_000) {
    throw new PenglaiError("SECURITY_POLICY", "office backup revision");
  }
  const digest = input.digest.replace(/^sha256:/, "").toLowerCase();
  if (!/^[0-9a-f]{16,64}$/.test(digest)) {
    throw new PenglaiError("SECURITY_POLICY", "office backup digest");
  }
  return `penglai-office-${input.operationId}-r${input.revision}-${digest.slice(0, 16)}.${input.kind}`;
}

export function nextOfficeBackupName(job: OfficeJobRecord, kind: "bak" | "undo"): string {
  job.backupRevision += 1;
  const digest = job.digest || job.sourceDigest;
  const name = officeBackupName({
    operationId: job.id,
    revision: job.backupRevision,
    digest,
    kind,
  });
  job.lastBackupName = name;
  return name;
}

export function freezePreviewDigest(job: OfficeJobRecord): string {
  job.previewResultDigest = digestBytes(job.bytes);
  job.digest = job.previewResultDigest;
  return job.previewResultDigest;
}

export function assertPreviewMatchesResult(job: OfficeJobRecord, bytes = job.bytes): void {
  if (!job.previewResultDigest) {
    throw new PenglaiError("SECURITY_POLICY", "office preview digest missing");
  }
  if (digestBytes(bytes) !== job.previewResultDigest) {
    throw new PenglaiError("SECURITY_POLICY", "office preview digest mismatch");
  }
}

export function createJob(input: Parameters<OfficeJobStore["create"]>[0]): OfficeJobRecord {
  return defaultStore.create(input);
}

export function getJob(id: string): OfficeJobRecord {
  return defaultStore.get(id);
}

export function setJobState(id: string, state: OfficeJobState, note = ""): OfficeJobRecord {
  return defaultStore.setState(id, state, note);
}

export function discardJob(id: string): void {
  defaultStore.discard(id);
}

export function cancelJob(id: string): void {
  defaultStore.cancel(id);
}

export function officeJobStats(): { size: number; inFlight: number } {
  return defaultStore.stats();
}

export function wipeAllJobs(): void {
  defaultStore.wipeAll();
}
