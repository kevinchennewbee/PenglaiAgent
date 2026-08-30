import { gzipSync, gunzipSync } from "fflate";

const GZIP_LEVEL = 9;
const GZIP_MTIME = 0;

export function deterministicGzip(bytes) {
  return Buffer.from(gzipSync(bytes, { level: GZIP_LEVEL, mtime: GZIP_MTIME }));
}

export function canonicalizeGzip(bytes) {
  return deterministicGzip(gunzipSync(bytes));
}
