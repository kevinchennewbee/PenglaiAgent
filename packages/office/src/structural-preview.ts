import { basename } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { artifactDigest } from "./pdf-preview.js";
import { detect, inspect } from "./service.js";
import { safeWorkspaceFilename } from "./transaction.js";
import type { OfficeFormat } from "./formats.js";

export type SpreadsheetCalculationStatus = "stored-formulas" | "calculated" | "unavailable";

export interface OfficeStructuralPreview {
  digest: string;
  format: OfficeFormat;
  text: string;
  parts: string[];
  externalOpen: { allowed: true; filename: string } | { allowed: false; reason: string };
  spreadsheet?: { calculationStatus: SpreadsheetCalculationStatus; formulaCount: number };
  imagePpt: { status: "not-supported"; reason: string };
}

export function bindOfficePreviewDigest(bytes: Buffer, digest: string): string {
  const actual = artifactDigest(bytes);
  const expected = digest.replace(/^sha256:/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected) || actual !== expected) {
    throw new PenglaiError("SECURITY_POLICY", "office preview digest mismatch");
  }
  return actual;
}

export function externalOpenPlan(input: {
  bytes: Buffer;
  digest: string;
  filename?: string;
}): { allowed: true; filename: string } | { allowed: false; reason: string } {
  try {
    bindOfficePreviewDigest(input.bytes, input.digest);
  } catch {
    return { allowed: false, reason: "digest mismatch" };
  }
  const raw = input.filename ?? "";
  if (!raw) return { allowed: false, reason: "filename required" };
  if (raw !== basename(raw) || raw.includes("..") || raw.includes("/") || raw.includes("\\")) {
    return { allowed: false, reason: "filename must be a workspace basename" };
  }
  try {
    return { allowed: true, filename: safeWorkspaceFilename(raw) };
  } catch (error) {
    return { allowed: false, reason: error instanceof Error ? error.message : "filename rejected" };
  }
}

const IMAGE_PPT = {
  status: "not-supported" as const,
  reason: "Penglai does not rasterize PowerPoint slides. Use inspect text or an Owner-approved external open.",
};

export async function previewOfficeStructure(
  bytes: Buffer,
  digest: string,
  filename?: string,
): Promise<OfficeStructuralPreview> {
  const bound = bindOfficePreviewDigest(bytes, digest);
  const format = detect(bytes);
  const seen = await inspect(bytes);
  if (seen.parts.length > 0 && seen.parts.every((part) => part.includes("/"))) {
    throw new PenglaiError("INVALID_INPUT", "office structural preview cannot be ZIP entry names alone");
  }
  return {
    digest: bound,
    format,
    text: seen.text,
    parts: seen.parts,
    externalOpen: externalOpenPlan({ bytes, digest: bound, ...(filename ? { filename } : {}) }),
    ...(format === "xlsx" && seen.spreadsheet ? { spreadsheet: seen.spreadsheet } : {}),
    imagePpt: IMAGE_PPT,
  };
}
