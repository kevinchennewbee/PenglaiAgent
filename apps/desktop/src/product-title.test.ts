import assert from "node:assert/strict";
import test from "node:test";
import { PENGLAI_DESKTOP_TITLE } from "./product-title.js";

test("desktop shell title remains the Penglai product identity", () => {
  assert.equal(PENGLAI_DESKTOP_TITLE, "蓬莱 Penglai");
});
