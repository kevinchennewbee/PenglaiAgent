#!/usr/bin/env node
/**
 * Protocol contract check (protocol ↔ host consistency).
 *
 * The protocol package declares the RPC surface's structured error codes
 * (ErrorCode in packages/protocol/src/index.ts). This script verifies the
 * host actually produces exactly that set — no dead codes, no undocumented
 * codes — so the two ends can never silently drift (the old union had both:
 * `tool_call_truncated`/`aborted` were never emitted, while 10+ real codes
 * were missing).
 *
 * Usage:
 *   node scripts/check-protocol-contract.mjs        # check (exit 1 on drift)
 *   node scripts/check-protocol-contract.mjs --fix  # rewrite the union
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const protocolFile = path.join(root, "packages/protocol/src/index.ts");
const hostSrc = path.join(root, "packages/host/src");
const fix = process.argv.includes("--fix");

// Codes the host emits ONLY as tool-result TEXT, never as RPC error codes.
// `needs_work_mode` is deliberately absent here: MemoryError also throws it,
// and that instance flows to the RPC surface via toRpcError.
const TEXT_ONLY_CODES = new Set([
  "policy_denied",
  "needs_approval",
  "needs_confirm",
  "l4_denied",
  "allowed",
]);

/** Walk host/src and collect `code: "x"` inside RPC error constructors. */
function collectEmittedCodes() {
  const codes = new Set();
  // Error classes whose `.code` reaches the RPC error surface: the JSON-RPC
  // constructors, plus MemoryError / ModeSwitchError which flow through
  // toRpcError's generic `.code` passthrough.
  const RPC_ERROR_CLASSES =
    "RpcError|ApprovalError|MemoryError|ModeSwitchError";
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const src = fs.readFileSync(p, "utf-8");
        // RpcError(-32000, "...", { code: "x" }) — bounded window after the
        // constructor call (跨行安全，限距防跨调用误捕)。
        for (const m of src.matchAll(
          new RegExp(`(?:new\\s+)?(?:${RPC_ERROR_CLASSES})[\\s\\S]{0,300}?code:\\s*"([a-z_]+)"`, "g"),
        )) {
          if (!TEXT_ONLY_CODES.has(m[1])) codes.add(m[1]);
        }
        // Positional code first argument: ApprovalError("x", ...) /
        // MemoryError("x", ...) /
        // ModeSwitchError("x", ...) — tolerate a newline after `(`.
        for (const m of src.matchAll(
          new RegExp(`(?:new\\s+)?(?:ApprovalError|MemoryError|ModeSwitchError)\\(\\s*"([a-z_]+)"`, "g"),
        )) {
          if (!TEXT_ONLY_CODES.has(m[1])) codes.add(m[1]);
        }
      }
    }
  };
  walk(hostSrc);
  return codes;
}

const emitted = collectEmittedCodes();

const declared = new Set(
  [
    ...fs
      .readFileSync(protocolFile, "utf-8")
      .match(/export type ErrorCode =[\s\S]*?;/)?.[0]
      .matchAll(/^\s*\|\s*"([a-z_]+)"/gm),
  ].map((m) => m[1]),
);

const missingInDeclared = [...emitted].filter((c) => !declared.has(c)).sort();
const declaredButNeverEmitted = [...declared].filter((c) => !emitted.has(c)).sort();

if (missingInDeclared.length === 0 && declaredButNeverEmitted.length === 0) {
  console.log(
    `protocol contract OK: ${declared.size} error codes, host emits exactly that set`,
  );
  process.exit(0);
}

if (fix) {
  const union = [
    ...declared,
    ...emitted,
  ].sort().map((c) => `  | "${c}"`).join("\n");
  const updated = fs
    .readFileSync(protocolFile, "utf-8")
    .replace(
      /export type ErrorCode =[\s\S]*?;/,
      `export type ErrorCode =\n${union};`,
    );
  fs.writeFileSync(protocolFile, updated);
  console.log("rewrote ErrorCode union; re-run without --fix to verify");
  process.exit(0);
}

const lines = [];
if (missingInDeclared.length > 0) {
  lines.push(
    `host emits error codes missing from protocol ErrorCode: ${missingInDeclared.join(", ")}`,
  );
}
if (declaredButNeverEmitted.length > 0) {
  lines.push(
    `protocol ErrorCode declares codes the host never emits: ${declaredButNeverEmitted.join(", ")}`,
  );
}
console.error(`protocol contract drift:\n${lines.join("\n")}`);
process.exit(1);
