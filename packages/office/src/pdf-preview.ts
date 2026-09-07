import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { inspectPdf } from "./adapters/pdf.js";

export interface PdfPagePreview {
  index: number;
  text: string;
  width: number;
  height: number;
  raster?: { mediaType: "image/png"; bytes: Buffer };
}

export interface PdfPreview {
  digest: string;
  pages: number;
  encrypted?: boolean;
  scanned?: boolean;
  pagePreviews: PdfPagePreview[];
}

export function artifactDigest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertPreviewDigest(bytes: Buffer, digest: string): string {
  const actual = artifactDigest(bytes);
  const expected = digest.replace(/^sha256:/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected) || actual !== expected) {
    throw new PenglaiError("SECURITY_POLICY", "PDF preview digest mismatch");
  }
  return actual;
}

export async function previewPdfPages(bytes: Buffer, digest: string): Promise<PdfPreview> {
  const bound = assertPreviewDigest(bytes, digest);
  const seen = await inspectPdf(bytes);
  const rasters = renderPdfRasters(bytes);
  return {
    digest: bound,
    pages: seen.pages,
    ...(seen.encrypted ? { encrypted: true } : {}),
    ...(seen.scanned ? { scanned: true } : {}),
    pagePreviews: seen.pageTexts.map((text, index) => ({
      index,
      text,
      width: 612,
      height: 792,
      ...(rasters[index] ? { raster: { mediaType: "image/png" as const, bytes: rasters[index]! } } : {}),
    })),
  };
}

function renderPdfRasters(bytes: Buffer): Buffer[] {
  const pdftoppm = spawnSync("which", ["pdftoppm"], { encoding: "utf8" });
  if (pdftoppm.status !== 0) return [];
  const bin = pdftoppm.stdout.trim();
  if (!bin) return [];
  const dir = mkdtempSync(join(tmpdir(), "penglai-pdf-preview-"));
  try {
    const prefix = join(dir, "page");
    const input = join(dir, "in.pdf");
    writeFileSync(input, bytes);
    const rendered = spawnSync(bin, ["-png", "-r", "36", input, prefix], { encoding: "utf8" });
    if (rendered.status !== 0) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith(".png"))
      .sort()
      .map((name) => readFileSync(join(dir, name)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
