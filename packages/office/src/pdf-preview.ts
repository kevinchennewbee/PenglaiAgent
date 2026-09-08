import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { inspectPdf } from "./adapters/pdf.js";

export const PDF_PREVIEW_LIMITS = Object.freeze({
  maxPages: 8,
  timeoutMs: 20_000,
  maxInputBytes: 8 * 1024 * 1024,
  maxRasterBytes: 1_500_000,
  maxTotalRasterBytes: 6 * 1024 * 1024,
  dpi: 72,
});

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type PdfRasterStatus = "rendered" | "unavailable" | "timeout" | "failed" | "limit";

export interface PdfPagePreview {
  index: number;
  text: string;
  width: number;
  height: number;
  rasterStatus: PdfRasterStatus;
  rasterReason?: string;
  raster?: { mediaType: "image/png"; bytes: Buffer };
}

export interface PdfPreview {
  digest: string;
  pages: number;
  encrypted?: boolean;
  scanned?: boolean;
  rasterEngine: "pdftoppm" | "none";
  rasterStatus: PdfRasterStatus;
  rasterReason?: string;
  pageLimit: number;
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

export function isPngRaster(bytes: Buffer | undefined): bytes is Buffer {
  return Boolean(bytes && bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC));
}

export async function previewPdfPages(
  bytes: Buffer,
  digest: string,
  options: { execPath?: string } = {},
): Promise<PdfPreview> {
  if (bytes.length > PDF_PREVIEW_LIMITS.maxInputBytes) {
    throw new PenglaiError("INVALID_INPUT", "PDF preview exceeds size limit");
  }
  const bound = assertPreviewDigest(bytes, digest);
  const seen = await inspectPdf(bytes);
  const pageCount = Math.max(seen.pages, seen.pageTexts.length);
  const limited = pageCount > PDF_PREVIEW_LIMITS.maxPages;
  const rendered = renderPdfRasters(
    bytes,
    Math.min(pageCount, PDF_PREVIEW_LIMITS.maxPages),
    options.execPath ?? process.execPath,
  );
  const pagePreviews = seen.pageTexts.slice(0, PDF_PREVIEW_LIMITS.maxPages).map((text, index) => {
    const size = seen.pageSizes[index] ?? { width: 612, height: 792 };
    const raster = rendered.pages[index];
    if (isPngRaster(raster)) {
      return {
        index,
        text,
        width: size.width,
        height: size.height,
        rasterStatus: "rendered" as const,
        raster: { mediaType: "image/png" as const, bytes: raster },
      };
    }
    return {
      index,
      text,
      width: size.width,
      height: size.height,
      rasterStatus: rendered.status,
      ...(rendered.reason ? { rasterReason: rendered.reason } : {}),
    };
  });
  const anyRendered = pagePreviews.some((page) => page.rasterStatus === "rendered");
  return {
    digest: bound,
    pages: pageCount,
    ...(seen.encrypted ? { encrypted: true } : {}),
    ...(seen.scanned ? { scanned: true } : {}),
    rasterEngine: rendered.engine,
    rasterStatus: anyRendered ? (limited ? "limit" : "rendered") : rendered.status,
    ...(anyRendered
      ? limited
        ? { rasterReason: `page preview limited to ${PDF_PREVIEW_LIMITS.maxPages} pages` }
        : {}
      : rendered.reason
        ? { rasterReason: rendered.reason }
        : {}),
    pageLimit: PDF_PREVIEW_LIMITS.maxPages,
    pagePreviews,
  };
}

export function publicPdfPreview(preview: PdfPreview) {
  return {
    digest: preview.digest,
    pages: preview.pages,
    scanned: preview.scanned,
    encrypted: preview.encrypted,
    rasterEngine: preview.rasterEngine,
    rasterStatus: preview.rasterStatus,
    rasterReason: preview.rasterReason,
    pageLimit: preview.pageLimit,
    pagePreviews: preview.pagePreviews.map((page) => {
      const raster = page.raster?.bytes;
      if (!isPngRaster(raster)) {
        return {
          index: page.index,
          text: page.text,
          width: page.width,
          height: page.height,
          rasterStatus: page.rasterStatus,
          rasterReason: [page.rasterReason, "text is not a page image"].filter(Boolean).join("; "),
        };
      }
      return {
        index: page.index,
        text: page.text,
        width: page.width,
        height: page.height,
        rasterStatus: "rendered" as const,
        raster: {
          mediaType: "image/png" as const,
          byteLength: raster.length,
          png: true,
          dataBase64: raster.toString("base64"),
        },
      };
    }),
  };
}

export function pdfRendererBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "pdftoppm.exe" : "pdftoppm";
}

export function bundledPdfRendererPath(execPath = process.execPath): string {
  return join(execPath, "..", "poppler", pdfRendererBinaryName());
}

export function pdfRendererCandidates(
  execPath = process.execPath,
  options: { platform?: NodeJS.Platform; appRoot?: string; explicit?: string } = {},
): string[] {
  const platform = options.platform ?? process.platform;
  const binary = pdfRendererBinaryName(platform);
  const execDir = dirname(execPath);
  const appRoot = options.appRoot ?? process.env.PENGLAI_APP_ROOT ?? "";
  const explicit = options.explicit ?? process.env.PENGLAI_PDFTOPPM ?? "";
  const candidates = [
    ...(explicit ? [explicit] : []),
    join(execDir, "poppler", binary),
    join(execDir, binary),
  ];
  if (appRoot) {
    candidates.push(join(appRoot, "poppler", binary));
    candidates.push(join(appRoot, "..", "poppler", binary));
    if (platform === "darwin") candidates.push(join(appRoot, "..", "MacOS", "poppler", binary));
  }
  return candidates;
}

export function locatePdfRenderer(execPath = process.execPath): string {
  return pdfRendererCandidates(execPath).find((path) => existsSync(path)) ?? "";
}

export function pdfRendererSpawnEnvForPlatform(
  platform: NodeJS.Platform,
  binDir: string,
  sourceEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const fonts = join(binDir, "fonts");
  const env: NodeJS.ProcessEnv = {};
  if (platform === "win32") {
    const systemRoot = sourceEnv.SystemRoot || sourceEnv.WINDIR || "C:\\Windows";
    env.PATH = `${join(systemRoot, "System32")};${systemRoot}`;
    env.SystemRoot = systemRoot;
    env.WINDIR = systemRoot;
    env.ComSpec = sourceEnv.ComSpec || join(systemRoot, "System32", "cmd.exe");
    env.PATHEXT = sourceEnv.PATHEXT || ".COM;.EXE;.BAT;.CMD";
    env.USERPROFILE = sourceEnv.USERPROFILE;
    env.TEMP = sourceEnv.TEMP;
    env.TMP = sourceEnv.TMP;
  } else {
    env.HOME = sourceEnv.HOME;
    env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
    env.TMPDIR = sourceEnv.TMPDIR;
    env.TEMP = sourceEnv.TEMP;
    env.TMP = sourceEnv.TMP;
    env.USERPROFILE = sourceEnv.USERPROFILE;
    if (sourceEnv.LANG) env.LANG = sourceEnv.LANG;
    if (sourceEnv.LC_ALL) env.LC_ALL = sourceEnv.LC_ALL;
  }
  if (existsSync(fonts)) env.FONTCONFIG_PATH = fonts;
  return env;
}

export function pdfRendererSpawnEnv(binDir: string): NodeJS.ProcessEnv {
  return pdfRendererSpawnEnvForPlatform(process.platform, binDir);
}

function renderPdfRasters(
  bytes: Buffer,
  maxPages: number,
  execPath = process.execPath,
): { engine: "pdftoppm" | "none"; status: PdfRasterStatus; reason?: string; pages: Buffer[] } {
  const bin = locatePdfRenderer(execPath);
  if (!bin) {
    return {
      engine: "none",
      status: "unavailable",
      reason: "no bundled pdftoppm; page images are not claimed from text",
      pages: [],
    };
  }
  const dir = mkdtempSync(join(tmpdir(), "penglai-pdf-preview-"));
  try {
    const prefix = join(dir, "page");
    const input = join(dir, "in.pdf");
    writeFileSync(input, bytes);
    const binDir = dirname(bin);
    const rendered = spawnSync(bin, ["-png", "-r", String(PDF_PREVIEW_LIMITS.dpi), "-f", "1", "-l", String(maxPages), input, prefix], {
      encoding: "utf8",
      cwd: binDir,
      timeout: PDF_PREVIEW_LIMITS.timeoutMs,
      env: pdfRendererSpawnEnv(binDir),
    });
    if (rendered.error && "code" in rendered.error && rendered.error.code === "ETIMEDOUT") {
      return { engine: "pdftoppm", status: "timeout", reason: "PDF raster timed out", pages: [] };
    }
    if (rendered.status !== 0) {
      return { engine: "pdftoppm", status: "failed", reason: "PDF raster failed", pages: [] };
    }
    const pages = readdirSync(dir)
      .filter((name) => name.endsWith(".png"))
      .sort()
      .map((name) => readFileSync(join(dir, name)))
      .filter((buf) => isPngRaster(buf) && buf.length <= PDF_PREVIEW_LIMITS.maxRasterBytes);
    const total = pages.reduce((sum, buf) => sum + buf.length, 0);
    if (pages.length === 0) {
      return { engine: "pdftoppm", status: "failed", reason: "PDF raster produced no PNG pages", pages: [] };
    }
    if (total > PDF_PREVIEW_LIMITS.maxTotalRasterBytes) {
      return {
        engine: "pdftoppm",
        status: "limit",
        reason: `PDF raster exceeds ${PDF_PREVIEW_LIMITS.maxTotalRasterBytes} byte memory bound`,
        pages: [],
      };
    }
    return { engine: "pdftoppm", status: "rendered", pages };
  } catch (error) {
    return {
      engine: "pdftoppm",
      status: "failed",
      reason: error instanceof Error ? error.message : "PDF raster failed",
      pages: [],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
