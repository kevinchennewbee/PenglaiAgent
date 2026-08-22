import { createHash, randomUUID } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import type { OfficeFormat } from "./formats.js";

export type OfficeJobState =
  | "CREATED"
  | "PLANNED"
  | "APPLIED"
  | "VERIFIED"
  | "AWAITING_APPROVAL"
  | "COMMITTED"
  | "DISCARDED"
  | "FAILED"
  | "CANCELLED";

export interface OfficeJobRecord {
  id: string;
  format: OfficeFormat;
  state: OfficeJobState;
  bytes: Buffer;
  text: string;
  workspaceId?: string;
  digest: string;
  beforeDigest?: string;
}

const jobs = new Map<string, OfficeJobRecord>();

export function digestBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createJob(
  format: OfficeFormat,
  bytes: Buffer,
  text: string,
  workspaceId?: string,
  beforeDigest?: string,
): OfficeJobRecord {
  const job: OfficeJobRecord = {
    id: `office-${randomUUID()}`,
    format,
    state: "CREATED",
    bytes: Buffer.from(bytes),
    text,
    digest: digestBytes(bytes),
    ...(workspaceId ? { workspaceId } : {}),
    ...(beforeDigest ? { beforeDigest } : {}),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): OfficeJobRecord {
  const job = jobs.get(id);
  if (!job) throw new PenglaiError("INVALID_INPUT", "office job not found");
  return job;
}

export function setJobState(id: string, state: OfficeJobState): OfficeJobRecord {
  const job = getJob(id);
  job.state = state;
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
