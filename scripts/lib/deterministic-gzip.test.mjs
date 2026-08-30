import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync as nativeGzipSync, gunzipSync as nativeGunzipSync } from "node:zlib";
import { canonicalizeGzip, deterministicGzip } from "./deterministic-gzip.mjs";

test("deterministic gzip canonicalizes different host compression streams", () => {
  const payload = Buffer.from("Penglai deterministic source closure\n".repeat(256));
  const fast = nativeGzipSync(payload, { level: 1, mtime: 0 });
  const dense = nativeGzipSync(payload, { level: 9, mtime: 0 });

  assert.notDeepEqual(fast, dense);
  assert.deepEqual(canonicalizeGzip(fast), canonicalizeGzip(dense));
  assert.deepEqual(nativeGunzipSync(deterministicGzip(payload)), payload);
});

test("deterministic gzip fixes the header timestamp", () => {
  const compressed = deterministicGzip(Buffer.from("fixed"));
  assert.deepEqual([...compressed.subarray(4, 8)], [0, 0, 0, 0]);
});
