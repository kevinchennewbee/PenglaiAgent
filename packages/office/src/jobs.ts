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
  sourcePath?: string;
  destPath?: string;
  digest: string;
  sourceDigest: string;
  ops: OfficeOperation[];
  opsDigest: string;
  receipt?: string;
  backupBytes?: Buffer;
  stagedBytes?: Buffer;
  resultDigest?: string;
  events: Array<{ at: number; state: OfficeJobState; note: string }>;
}

const jobs = new Map<string, OfficeJobRecord>();

export function digestBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function digestOps(ops: OfficeOperation[]): string {
  return createHash("sha256").update(JSON.stringify(ops)).digest("hex");
}

export function createJob(input: {
  format: OfficeFormat;
  bytes: Buffer;
  text: string;
  parts?: string[];
  warnings?: string[];
  workspaceId?: string;
  sourcePath?: string;
  destPath?: string;
  ops?: OfficeOperation[];
}): OfficeJobRecord {
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
    ops,
    opsDigest: digestOps(ops),
    events: [{ at: Date.now(), state: "INSPECTED", note: "inspect" }],
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
    ...(input.destPath ? { destPath: input.destPath } : {}),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): OfficeJobRecord {
  const job = jobs.get(id);
  if (!job) throw new PenglaiError("INVALID_INPUT", "office job not found");
  return job;
}

export function setJobState(id: string, state: OfficeJobState, note = ""): OfficeJobRecord {
  const job = getJob(id);
  job.state = state;
  job.events.push({ at: Date.now(), state, note });
  return job;
}

export function discardJob(id: string): void {
  const job = getJob(id);
  job.state = "DISCARDED";
  jobs.delete(id);
}

export function cancelJob(id: string): void {
  const job = getJob(id);
  job.state = "CANCELLED";
  jobs.delete(id);
}
