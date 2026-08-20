import assert from "node:assert/strict";
import test from "node:test";
import { apply, version } from "./index.js";

test("reference plugin exposes a version", () => {
  assert.equal(typeof version, "string");
  assert.equal(apply().version, version);
});
