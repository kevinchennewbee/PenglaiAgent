import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createPdf, inspectPdf } from "./adapters/pdf.js";
import {
  artifactDigest,
  locatePdfRenderer,
  pdfRendererCandidates,
  pdfRendererSpawnEnv,
  pdfRendererSpawnEnvForPlatform,
  previewPdfPages,
  publicPdfPreview,
} from "./pdf-preview.js";
import { prepareRunnablePopplerHelper } from "../../../scripts/lib/package-poppler.mjs";

test("PDF inspect stays linear on BT-repeat noise inside a real created document", async () => {
  const bytes = await createPdf(`BT-noise ${"BTa".repeat(8_000)} visible-marker`);
  const started = Date.now();
  const seen = await inspectPdf(bytes);
  assert.match(seen.text, /visible-marker/);
  assert.ok(Date.now() - started < 2_000);
});

test("PDF inspect keeps full created body and does not treat title metadata as the page", async () => {
  const body = "alpha-line\n".repeat(40);
  const bytes = await createPdf(body);
  const seen = await inspectPdf(bytes);
  assert.ok(seen.text.includes("alpha-line"));
  assert.ok(seen.text.length > 180);
  assert.ok(seen.parts.some((part) => /^page\d+:/.test(part) && part.includes("alpha-line")));
  assert.equal(
    seen.parts.some((part) => part.startsWith("title:") && part.includes("alpha-line")),
    false,
  );
});

test("PDF page preview is bound to the reviewed artifact digest", async () => {
  const bytes = await createPdf("preview-body-one\npreview-body-two");
  const digest = artifactDigest(bytes);
  const preview = await previewPdfPages(bytes, digest);
  assert.equal(preview.digest, digest);
  assert.ok(preview.pagePreviews.some((page) => page.text.includes("preview-body-one")));
  const other = await createPdf("different-document");
  await assert.rejects(() => previewPdfPages(other, digest), /digest mismatch/);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), digest);
});

test("PDF page text is never treated as a page image", async () => {
  const { publicPdfPreview } = await import("./pdf-preview.js");
  const bytes = await createPdf("visible-preview-text");
  const preview = publicPdfPreview(await previewPdfPages(bytes, artifactDigest(bytes)));
  for (const page of preview.pagePreviews) {
    if (page.raster) {
      assert.equal(page.raster.mediaType, "image/png");
      assert.equal(page.raster.png, true);
      assert.equal(Buffer.from(page.raster.dataBase64, "base64")[0], 0x89);
    } else {
      assert.notEqual(page.rasterStatus, "rendered");
      assert.match(String(page.rasterReason), /not a page image|unavailable|failed|timeout|not claimed from text/i);
    }
  }
  if (preview.rasterStatus !== "rendered") {
    assert.notEqual(preview.rasterEngine, undefined);
    assert.ok(preview.pagePreviews.some((page) => page.text.includes("visible-preview-text")));
  }
});

test("PDF raster spawn keeps a system PATH and does not inherit dyld overrides", () => {
  const env = pdfRendererSpawnEnv("/tmp");
  assert.equal(env.PATH, "/usr/bin:/bin:/usr/sbin:/sbin");
  assert.equal(env.DYLD_LIBRARY_PATH, undefined);
  assert.equal(env.LD_LIBRARY_PATH, undefined);
});

test("PDF raster spawn on Windows uses SystemRoot, not a Unix PATH", () => {
  const env = pdfRendererSpawnEnvForPlatform("win32", "C:\\Penglai\\poppler", {
    SystemRoot: "C:\\Windows",
    USERPROFILE: "C:\\Users\\owner",
    TEMP: "C:\\Users\\owner\\AppData\\Local\\Temp",
    TMP: "C:\\Users\\owner\\AppData\\Local\\Temp",
  });
  assert.match(String(env.PATH), /System32/);
  assert.equal(env.SystemRoot, "C:\\Windows");
  assert.equal(env.WINDIR, "C:\\Windows");
  assert.doesNotMatch(String(env.PATH), /\/usr\/bin/);
  assert.equal(env.DYLD_LIBRARY_PATH, undefined);
});

test("packaged pdftoppm is found from DSH Node execPath via app root, not only next to Node", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-pdf-layout-"));
  try {
    const macResources = join(root, "Penglai.app", "Contents", "Resources");
    const macHelper = join(root, "Penglai.app", "Contents", "MacOS", "poppler", "pdftoppm");
    const macNode = join(macResources, "runtime", "node", "bin", "node");
    mkdirSync(dirname(macHelper), { recursive: true });
    mkdirSync(dirname(macNode), { recursive: true });
    writeFileSync(macHelper, "helper");
    writeFileSync(macNode, "node");
    const macHits = pdfRendererCandidates(macNode, { platform: "darwin", appRoot: macResources });
    assert.equal(macHits.some((path) => path === macHelper), true);
    assert.equal(locatePdfRenderer(macNode), "");
    const previousApp = process.env.PENGLAI_APP_ROOT;
    const previousExplicit = process.env.PENGLAI_PDFTOPPM;
    process.env.PENGLAI_APP_ROOT = macResources;
    delete process.env.PENGLAI_PDFTOPPM;
    try {
      assert.equal(locatePdfRenderer(macNode), macHelper);
    } finally {
      if (previousApp === undefined) delete process.env.PENGLAI_APP_ROOT;
      else process.env.PENGLAI_APP_ROOT = previousApp;
      if (previousExplicit === undefined) delete process.env.PENGLAI_PDFTOPPM;
      else process.env.PENGLAI_PDFTOPPM = previousExplicit;
    }

    const winPayload = join(root, "payload");
    const winHelper = join(winPayload, "poppler", "pdftoppm.exe");
    const winNode = join(winPayload, "resources", "runtime", "node", "node.exe");
    mkdirSync(dirname(winHelper), { recursive: true });
    mkdirSync(dirname(winNode), { recursive: true });
    writeFileSync(winHelper, "helper");
    writeFileSync(winNode, "node");
    const winHits = pdfRendererCandidates(winNode, {
      platform: "win32",
      appRoot: join(winPayload, "resources"),
    });
    assert.equal(winHits.some((path) => path === winHelper), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bundled pdftoppm next to execPath renders digest-bound PNG page images", async (t) => {
  const targetDir =
    process.platform === "win32"
      ? "win32-x86_64"
      : process.arch === "arm64"
        ? "darwin-aarch64"
        : "darwin-x86_64";
  const binary = process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm";
  const popplerRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../third_party/poppler", targetDir);
  const host = join(popplerRoot, binary);
  const manifestPath = join(popplerRoot, "manifest.json");
  assert.equal(locatePdfRenderer("/tmp/no-such-penglai-exec"), "");
  if (!existsSync(host) || !existsSync(manifestPath)) {
    t.skip("pinned conda pdftoppm not assembled");
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { source?: unknown };
  const source = typeof manifest.source === "string" ? manifest.source : "";
  if (!source.includes("conda.anaconda.org/conda-forge/") || !source.includes("poppler-26.09.0")) {
    t.skip("host poppler tree is not the pinned conda-forge 26.09.0 package");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "penglai-pdf-bundle-"));
  try {
    const execPath = join(root, process.platform === "win32" ? "Penglai.exe" : "Penglai");
    writeFileSync(execPath, "fake-exec");
    chmodSync(execPath, 0o755);
    const runnable = prepareRunnablePopplerHelper(popplerRoot, root);
    const previousApp = process.env.PENGLAI_APP_ROOT;
    const previousExplicit = process.env.PENGLAI_PDFTOPPM;
    delete process.env.PENGLAI_APP_ROOT;
    delete process.env.PENGLAI_PDFTOPPM;
    try {
    assert.equal(locatePdfRenderer(execPath), runnable.bin);
    const pdf = await PDFDocument.create();
    const pageDoc = pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    pageDoc.drawRectangle({ x: 72, y: 620, width: 468, height: 88, color: rgb(0.77, 0.36, 0.15) });
    pageDoc.drawText("Penglai 0.5.12", { x: 96, y: 652, size: 32, font, color: rgb(0.96, 0.94, 0.91) });
    pageDoc.drawText("Official PDF page raster", { x: 72, y: 560, size: 18, font, color: rgb(0.04, 0.11, 0.17) });
    const bytes = Buffer.from(await pdf.save());
    const digest = artifactDigest(bytes);
    const preview = await previewPdfPages(bytes, digest, { execPath });
    assert.equal(preview.rasterEngine, "pdftoppm");
    assert.equal(preview.rasterStatus, "rendered");
    const page = preview.pagePreviews.find((row) => row.rasterStatus === "rendered");
    assert.ok(page?.raster?.bytes);
    assert.equal(page.raster.bytes[0], 0x89);
    assert.equal(page.raster.bytes[1], 0x50);
    const published = publicPdfPreview(preview);
    assert.equal(published.pagePreviews[0].raster.png, true);
    } finally {
      if (previousApp === undefined) delete process.env.PENGLAI_APP_ROOT;
      else process.env.PENGLAI_APP_ROOT = previousApp;
      if (previousExplicit === undefined) delete process.env.PENGLAI_PDFTOPPM;
      else process.env.PENGLAI_PDFTOPPM = previousExplicit;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
