import type { OfficeJobRecord } from "./jobs.js";
import { OFFICE_LIMITS } from "./operations.js";

export interface PreviewArtifact {
  kind: "inventory" | "diff" | "warning";
  format: string;
  text: string;
  parts?: string[];
  warnings?: string[];
}

export function previewJob(job: OfficeJobRecord): PreviewArtifact[] {
  const warnings = [...job.warnings, OFFICE_LIMITS[job.format]];
  return [
    {
      kind: "inventory",
      format: job.format,
      text: job.text,
      parts: job.parts,
      warnings,
    },
    {
      kind: "diff",
      format: job.format,
      text: `source=${job.sourceDigest.slice(0, 16)} result=${job.digest.slice(0, 16)} ops=${job.ops.map((op) => op.kind).join(",")}`,
    },
    ...warnings.map((text) => ({ kind: "warning" as const, format: job.format, text })),
  ];
}
