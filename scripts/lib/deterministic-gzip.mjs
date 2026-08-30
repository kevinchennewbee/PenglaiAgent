import { createRequire } from "node:module";

const GZIP_LEVEL = 9;
const GZIP_MTIME = 0;
const require = createRequire(import.meta.url);

function loadFflate() {
  return require("fflate");
}

export function deterministicGzip(bytes) {
  const { gzipSync } = loadFflate();
  return Buffer.from(gzipSync(bytes, { level: GZIP_LEVEL, mtime: GZIP_MTIME }));
}

export function canonicalizeGzip(bytes) {
  const { gunzipSync } = loadFflate();
  return deterministicGzip(gunzipSync(bytes));
}
