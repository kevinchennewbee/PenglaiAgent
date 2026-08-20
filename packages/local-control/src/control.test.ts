import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeListenHost, PenglaiError } from "@penglai/contracts";

test("control host cannot be 0.0.0.0", () => {
  assert.throws(() => assertSafeListenHost("0.0.0.0"), PenglaiError);
});
