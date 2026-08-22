import assert from "node:assert/strict";
import test from "node:test";
import { applyFuseWire, assertRequiredFuses, ELECTRON_FUSE_SENTINEL, inspectFuseWire } from "./fuses.js";

function sample(): Buffer {
  const head = Buffer.from("HEAD");
  const sent = Buffer.from(ELECTRON_FUSE_SENTINEL);
  const meta = Buffer.from([1, 8]);
  const fuses = Buffer.from("10110001", "ascii");
  const tail = Buffer.from("TAIL");
  return Buffer.concat([head, sent, meta, fuses, tail]);
}

test("R50-SEC-004 fuse wire is read from binary bytes not config strings", () => {
  const info = inspectFuseWire(sample());
  assert.equal(info.values.runAsNode, true);
  assert.equal(info.values.enableNodeCliInspectArguments, true);
  assert.equal(info.values.onlyLoadAppFromAsar, false);
  const flipped = applyFuseWire(sample(), {
    runAsNode: false,
    enableNodeCliInspectArguments: false,
    enableNodeOptionsEnvironmentVariable: false,
  });
  const after = inspectFuseWire(flipped);
  assert.equal(after.values.runAsNode, false);
  assert.equal(after.values.enableNodeOptionsEnvironmentVariable, false);
  assert.equal(after.values.enableNodeCliInspectArguments, false);
  assert.doesNotThrow(() => assertRequiredFuses(after.values));
  assert.throws(() => assertRequiredFuses(info.values));
  assert.throws(() => assertRequiredFuses({ ...after.values, enableNodeOptionsEnvironmentVariable: true }));
});

test("R50-MAC-005 nine-byte Electron 43 fuse wire keeps onlyLoadAppFromAsar false", () => {
  const head = Buffer.from("HEAD");
  const sent = Buffer.from(ELECTRON_FUSE_SENTINEL);
  const meta = Buffer.from([1, 9]);
  const fuses = Buffer.from("101100011", "ascii");
  const buf = Buffer.concat([head, sent, meta, fuses, Buffer.from("TAIL")]);
  const before = inspectFuseWire(buf);
  assert.equal(before.count, 9);
  assert.equal(before.values.runAsNode, true);
  const after = inspectFuseWire(
    applyFuseWire(buf, {
      runAsNode: false,
      enableNodeCliInspectArguments: false,
      enableNodeOptionsEnvironmentVariable: false,
    }),
  );
  assert.equal(after.values.runAsNode, false);
  assert.equal(after.values.enableNodeCliInspectArguments, false);
  assert.equal(after.values.onlyLoadAppFromAsar, false);
});
