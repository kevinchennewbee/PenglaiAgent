import type { OfficeJobRecord } from "./jobs.js";

export interface OfficeDiff {
  jobId: string;
  beforeDigest?: string;
  afterDigest: string;
  changed: boolean;
}

export function diffJob(job: OfficeJobRecord): OfficeDiff {
  return {
    jobId: job.id,
    ...(job.beforeDigest ? { beforeDigest: job.beforeDigest } : {}),
    afterDigest: job.digest,
    changed: Boolean(job.beforeDigest && job.beforeDigest !== job.digest),
  };
}
