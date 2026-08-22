import type { OfficeJobRecord } from "./jobs.js";

export interface PreviewArtifact {
  kind: "text";
  format: string;
  text: string;
}

export function previewJob(job: OfficeJobRecord): PreviewArtifact[] {
  return [{ kind: "text", format: job.format, text: job.text.slice(0, 2000) }];
}
