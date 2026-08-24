import type { OfficeJobRecord } from "./jobs.js";
import { freezePreviewDigest } from "./jobs.js";
import { OFFICE_LIMITS } from "./operations.js";

export interface PreviewArtifact {
  kind: "inventory" | "diff" | "warning";
  format: string;
  text: string;
  digest?: string;
  sourceDigest?: string;
  parts?: string[];
  warnings?: string[];
}

export function previewJob(job: OfficeJobRecord): PreviewArtifact[] {
  const digest = freezePreviewDigest(job);
  const warnings = [...job.warnings, OFFICE_LIMITS[job.format]];
  return [
    {
      kind: "inventory",
      format: job.format,
      text: job.text,
      digest,
      sourceDigest: job.sourceDigest,
      parts: job.parts,
      warnings,
    },
    {
      kind: "diff",
      format: job.format,
      text: `source=${job.sourceDigest} result=${digest} ops=${job.ops.map((op) => op.kind).join(",")}`,
      digest,
      sourceDigest: job.sourceDigest,
    },
    ...warnings.map((text) => ({ kind: "warning" as const, format: job.format, text })),
  ];
}
