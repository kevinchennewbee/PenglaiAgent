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
    beforeDigest: job.sourceDigest,
    afterDigest: job.digest,
    changed: job.sourceDigest !== job.digest,
  };
}
