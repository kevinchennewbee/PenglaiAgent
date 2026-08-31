import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePenglaiDocumentTitle,
  PENGLAI_DESKTOP_TITLE,
} from "./product-title.js";

test("desktop shell title remains the Penglai product identity", () => {
  assert.equal(PENGLAI_DESKTOP_TITLE, "蓬莱 Penglai");
});

test("upstream DSH branding cannot replace the Penglai document title", () => {
  assert.equal(normalizePenglaiDocumentTitle("DeepSeek Harness"), PENGLAI_DESKTOP_TITLE);
  assert.equal(normalizePenglaiDocumentTitle("deepseek harness - Settings"), PENGLAI_DESKTOP_TITLE);
  assert.equal(normalizePenglaiDocumentTitle("Workspace conversation"), "Workspace conversation");
});
