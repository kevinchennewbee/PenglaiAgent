import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPdf, inspectPdf } from "./adapters/pdf.js";
import { artifactDigest, previewPdfPages, publicPdfPreview } from "./pdf-preview.js";

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

test("0.5.12 PDF preview does not package or locate bundled Poppler", () => {
  const src = readFileSync(new URL("./pdf-preview.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /third_party\/poppler/);
  assert.doesNotMatch(src, /PENGLAI_PDFTOPPM/);
  assert.doesNotMatch(src, /join\([^)]*poppler/);
  assert.doesNotMatch(src, /bundled pdftoppm/);
});
