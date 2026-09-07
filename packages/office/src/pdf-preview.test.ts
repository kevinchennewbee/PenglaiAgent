import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createPdf, inspectPdf } from "./adapters/pdf.js";
import { artifactDigest, previewPdfPages } from "./pdf-preview.js";

test("PDF inspect keeps full created body and does not treat title metadata as the page", async () => {
  const body = "alpha-line\n".repeat(40);
  const bytes = await createPdf(body);
  const seen = await inspectPdf(bytes);
  assert.ok(seen.text.includes("alpha-line"));
  assert.ok(seen.text.length > 180);
  assert.ok(seen.parts.some((part) => part.startsWith("page0:") && part.includes("alpha-line")));
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
