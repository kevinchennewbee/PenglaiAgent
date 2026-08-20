import assert from "node:assert/strict";
import test from "node:test";
import { VirtualClock } from "./index.js";

test("virtual clock advances without wall wait", () => {
  const c = new VirtualClock();
  const a = c.now();
  c.advance(5000);
  assert.equal(c.now() - a, 5000);
});
