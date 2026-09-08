import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createPdf, inspectPdf } from "./adapters/pdf.js";
import {
  artifactDigest,
  bundledPdfRendererPath,
  locatePdfRenderer,
  previewPdfPages,
  publicPdfPreview,
} from "./pdf-preview.js";

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
    mkdirSync(join(root, "poppler"));
    const bundled = bundledPdfRendererPath(execPath);
    symlinkSync(host, bundled);
    assert.equal(locatePdfRenderer(execPath), bundled);
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
    rmSync(root, { recursive: true, force: true });
  }
});
