#!/usr/bin/env node
/**
 * R11 static renderer/Host build boundary check.
 *
 * The Desktop renderer (packages/desktop/src) is bundled by Vite into a
 * browser webview. Host-only network implementations (node:dns, undici,
 * connection-time private-IP gates) must never enter that bundle.
 *
 * Checks:
 *   1. Renderer source never imports node:* builtins or fs/path/os/child_process.
 *   2. Renderer source never imports Host network implementation modules
 *      (network-safety, provider-transport, safe-inference-fetch, providers/models).
 *   3. The built dist bundle contains no markers of Host network internals.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopSrc = path.join(root, "packages/desktop/src");
const distDir = path.join(root, "packages/desktop/dist");

const NODE_BUILTIN_RE = /^node:/;
const NODE_CORE_MODULES = new Set([
  "fs", "path", "os", "net", "dns", "http", "https", "child_process",
  "crypto", "stream", "util", "events", "tty", "url", "zlib", "worker_threads",
  "perf_hooks", "async_hooks",
]);
const HOST_NETWORK_MODULES = [
  "network-safety",
  "provider-transport",
  "safe-inference-fetch",
  "providers/models",
  "capabilities/network-safety",
];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

let failures = 0;
const report = (ok, msg) => {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures += 1;
};

const files = [];
walk(desktopSrc, files);

for (const file of files) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  const importRe = /import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g;
  // Also dynamic import("...")
  const dynamicRe = /import\(\s*["']([^"']+)["']\s*\)/g;
  const targets = [];
  let m;
  while ((m = importRe.exec(text))) targets.push(m[1]);
  while ((m = dynamicRe.exec(text))) targets.push(m[1]);

  for (const target of targets) {
    const bare = target.replace(/\.js$/, "");
    if (NODE_BUILTIN_RE.test(target)) {
      report(false, `${rel} imports Node builtin "${target}"`);
      continue;
    }
    if (NODE_CORE_MODULES.has(bare)) {
      report(false, `${rel} imports Node core module "${target}"`);
      continue;
    }
    for (const net of HOST_NETWORK_MODULES) {
      if (target.includes(net)) {
        report(false, `${rel} imports Host network module "${target}"`);
      }
    }
  }
}

if (fs.existsSync(distDir)) {
  const assets = [];
  const walkDist = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDist(full);
      else if (/\.(js|mjs)$/.test(entry.name)) assets.push(full);
    }
  };
  walkDist(distDir);
  const MARKERS = ["node:dns", "undici", "PUBLIC_NETWORK_DISPATCHER", "assertPublicHttpUrl", "dns/promises"];
  for (const asset of assets) {
    const rel = path.relative(root, asset);
    const text = fs.readFileSync(asset, "utf8");
    for (const marker of MARKERS) {
      if (text.includes(marker)) {
        report(false, `${rel} contains Host network marker "${marker}"`);
      }
    }
  }
  report(true, `dist assets scanned: ${assets.length} file(s)`);
} else {
  report(false, "desktop dist not found — run npm run build first");
}

if (failures > 0) {
  console.log(`\nrenderer network boundary FAILED (${failures} issue(s))`);
  process.exit(1);
}
console.log("\nrenderer network boundary OK: no Node network modules in renderer graph");
