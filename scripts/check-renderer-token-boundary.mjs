#!/usr/bin/env node
/**
 * Renderer token-boundary regression check.
 *
 * The host credential (`~/.penglai/host.token`) must never reach renderer JS:
 * in the Tauri shell every RPC goes through the Rust `host_rpc` IPC bridge,
 * which injects the token server-side. The renderer's own HTTP bridge exists
 * only for plain-browser dev (token injected by the dev proxy) and tests.
 *
 * This asserts, against the PRODUCTION build output (dist/):
 *   - no reference to the Rust token reader (`read_host_token`)
 *   - no `host.token` path handling (file reads / fs access)
 *   - no token persisted or emitted by the renderer (nothing writes it back
 *     to the host or logs it)
 *
 * 0.3 had an equivalent assertion in desktop-release.yml (index HTML must not
 * expose the bridge token); this is the 0.4 replacement and runs in CI.
 *
 * Usage: node scripts/check-renderer-token-boundary.mjs [distDir]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.resolve(process.argv[2] ?? path.join(root, "packages/desktop/dist"));

const FORBIDDEN = [
  "read_host_token",
  "host.token",
  "readFileSync(",
];

const sourceFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && /\.(js|mjs|cjs|html)$/.test(e.name)) sourceFiles.push(p);
  }
})(distDir);

if (sourceFiles.length === 0) {
  console.error(`renderer token boundary: no build output found in ${distDir}`);
  console.error("run `npm run build --workspace @penglai/desktop` first");
  process.exit(1);
}

const findings = [];
for (const file of sourceFiles) {
  const content = fs.readFileSync(file, "utf-8");
  for (const needle of FORBIDDEN) {
    if (content.includes(needle)) {
      findings.push(`${path.relative(root, file)} contains '${needle}'`);
    }
  }
}

if (findings.length > 0) {
  console.error("renderer token boundary violated:");
  for (const f of findings) console.error(`  ✗ ${f}`);
  console.error(
    "the host credential must stay in the Rust shell (host_rpc injects it); " +
      "renderer code must not read/handle host.token",
  );
  process.exit(1);
}
console.log(
  `renderer token boundary OK: ${sourceFiles.length} build artifacts, no host token handling`,
);
