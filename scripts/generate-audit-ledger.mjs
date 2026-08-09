#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = path.join(ROOT, "docs/audit/FILE_LEDGER_0.4.0.csv");
const outputArg = process.argv.indexOf("--output");
const output = path.resolve(
  ROOT,
  outputArg >= 0 ? process.argv[outputArg + 1] ?? defaultOutput : defaultOutput,
);

function csv(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function area(file) {
  if (file.startsWith("packages/host/src/")) return "0.4-host-production";
  if (file.startsWith("packages/desktop/src-tauri/") || file.startsWith("packages/desktop/updater/")) return "0.4-desktop-native-update";
  if (file.startsWith("packages/desktop/src/")) return "0.4-desktop-renderer";
  if (file.startsWith("packages/protocol/")) return "0.4-protocol";
  if (file.startsWith("packages/host/test/") || file.startsWith("packages/desktop/test/") || file.startsWith("tests/")) return "tests";
  if (file.startsWith(".github/")) return "github-release-ci";
  if (file.endsWith("lock.json") || file.endsWith("Cargo.lock") || file === "package-lock.json") return "dependency-lock";
  if (/\.(md|txt|json|ya?ml|toml)$/i.test(file)) return "docs-config";
  if (/\.(png|ico|icns|pdf|dmg|exe|deb|zip|gz|bz2|onnx|model)$/i.test(file)) return "binary-asset";
  if (/\.(py|js|mjs|cjs|ts|tsx|rs|sh|css|html)$/i.test(file)) return "legacy-or-support-source";
  return "other";
}

function coverage(file, group, binary) {
  if (binary) return "sha256+format/build/package inspection";
  if (group === "0.4-host-production") return "byte/line inventory+TypeScript compiler+Semgrep+targeted manual trust-boundary review+Vitest";
  if (group === "0.4-desktop-native-update") return "byte/line inventory+Rust/TypeScript compiler+Semgrep+targeted manual trust-boundary review+tests";
  if (group === "0.4-desktop-renderer") return "byte/line inventory+TypeScript compiler+Semgrep+targeted manual IPC/XSS review+Vitest";
  if (group === "0.4-protocol") return "line scan+TypeScript compiler+contract tests";
  if (group === "tests") return "line scan+syntax/compiler+executed test suite";
  if (group === "github-release-ci") return "byte/line inventory+targeted manual release review+actionlint+shellcheck";
  if (group === "dependency-lock") return "line scan+package parser+SCA+SBOM";
  if (group === "legacy-or-support-source") return "byte/line inventory+syntax compiler+Semgrep/Bandit+targeted dangerous-API review+tests";
  if (group === "docs-config") return "byte/line inventory+targeted claim/config consistency review";
  return "line scan+hash+repository consistency review";
}

const raw = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: ROOT,
  encoding: "buffer",
});
const relativeOutput = path.relative(ROOT, output).split(path.sep).join("/");
const files = raw
  .toString("utf-8")
  .split("\0")
  .filter(Boolean)
  .filter((file) => file !== relativeOutput)
  .sort((a, b) => a.localeCompare(b));

const trackedModes = new Map(
  execFileSync("git", ["ls-files", "-s", "-z"], { cwd: ROOT, encoding: "buffer" })
    .toString("utf-8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match = /^(\d+)\s+[0-9a-f]+\s+\d+\t([\s\S]+)$/.exec(entry);
      return match ? [match[2], match[1]] : [entry, "untracked"];
    }),
);

const rows = [];
let totalBytes = 0;
let totalLines = 0;
for (const file of files) {
  const absolute = path.join(ROOT, file);
  // `git ls-files --cached` also lists paths deleted in the working tree.
  // They are changes to review, but are not part of the candidate snapshot.
  let stat;
  let data;
  let symlink = false;
  try {
    if (trackedModes.get(file) === "120000") {
      symlink = true;
      data = Buffer.from(fs.readlinkSync(absolute), "utf-8");
    } else {
      const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
      const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | noFollow);
      try {
        stat = fs.fstatSync(descriptor);
        if (!stat.isFile()) throw new Error(`candidate is not a regular file: ${file}`);
        data = fs.readFileSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    if (error?.code === "ELOOP") {
      symlink = true;
      data = Buffer.from(fs.readlinkSync(absolute), "utf-8");
    } else {
      throw error;
    }
  }
  const binary = data.includes(0);
  // For text, decoding and splitting here deliberately traverses every byte
  // and every line; language-aware gates provide the semantic layer.
  const text = binary ? "" : data.toString("utf-8");
  const lines = binary || data.length === 0 ? 0 : text.split(/\r?\n/).length;
  const group = area(file);
  totalBytes += data.length;
  totalLines += lines;
  rows.push([
    file,
    trackedModes.get(file) ?? "untracked",
    data.length,
    lines,
    crypto.createHash("sha256").update(data).digest("hex"),
    symlink ? "symlink-target" : binary ? "binary" : "text",
    group,
    coverage(file, group, binary),
  ]);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const header = ["path", "git_mode", "bytes", "lines", "sha256", "media", "area", "coverage"];
const body = [header, ...rows].map((row) => row.map(csv).join(",")).join("\n");
fs.writeFileSync(output, `${body}\n`, "utf-8");
process.stdout.write(
  `${JSON.stringify({ output: relativeOutput, files: rows.length, bytes: totalBytes, textLines: totalLines })}\n`,
);
