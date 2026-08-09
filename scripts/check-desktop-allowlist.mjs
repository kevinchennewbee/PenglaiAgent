#!/usr/bin/env node
/**
 * Desktop renderer allowlist check.
 *
 * The Rust `host_rpc` bridge forwards only an allowlisted set of RPC methods
 * to the Host (defense-in-depth: an XSS in the webview must never reach the
 * full product database). This script verifies:
 *
 *   1. Every RPC method the renderer calls is in the allowlist
 *      (a missing entry = broken feature; it will be rejected at runtime).
 *   2. The allowlist contains nothing the renderer never calls and the Host
 *      never implements (dead entries invite drift).
 *
 * Usage: node scripts/check-desktop-allowlist.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopSrc = path.join(root, "packages/desktop/src");
const libRs = path.join(root, "packages/desktop/src-tauri/src/lib.rs");
const serverTs = path.join(root, "packages/host/src/server.ts");

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
}

// Renderer RPC call sites are parsed with the TypeScript compiler. A regex
// misses multiline generic calls and conditional method expressions; those
// misses previously let renderer features pass CI and then fail at runtime.
// Every method expression must resolve to literal strings here. Dynamic RPC
// method construction fails closed because it cannot be audited mechanically.
const rendererFiles = [];
walk(desktopSrc, rendererFiles);
const rendererMethods = new Set();
const unresolvedRendererCalls = [];

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function collectStaticMethods(expression, sourceFile) {
  const current = unwrapExpression(expression);
  if (ts.isStringLiteralLike(current)) {
    return [current.text];
  }
  if (ts.isConditionalExpression(current)) {
    const whenTrue = collectStaticMethods(current.whenTrue, sourceFile);
    const whenFalse = collectStaticMethods(current.whenFalse, sourceFile);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
  }
  return null;
}

for (const file of rendererFiles) {
  const src = fs.readFileSync(file, "utf-8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "rpc"
    ) {
      const methods = node.arguments[0]
        ? collectStaticMethods(node.arguments[0], sourceFile)
        : null;
      if (!methods || methods.length === 0) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        unresolvedRendererCalls.push(
          `${path.relative(root, file)}:${line + 1}:${character + 1} ${node.getText(sourceFile).slice(0, 160)}`,
        );
      } else {
        for (const method of methods) {
          if (!/^[a-z]+\.[a-zA-Z.]+$/.test(method)) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            unresolvedRendererCalls.push(
              `${path.relative(root, file)}:${line + 1}:${character + 1} invalid RPC literal ${JSON.stringify(method)}`,
            );
          } else {
            rendererMethods.add(method);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

const libRsSource = fs.readFileSync(libRs, "utf-8");
const allowlistMatch = libRsSource.match(/ALLOWED_HOST_METHODS: &\[&str\] = &\[([\s\S]*?)\];/);
if (!allowlistMatch) {
  console.error("desktop allowlist: ALLOWED_HOST_METHODS block not found in lib.rs");
  process.exit(1);
}
const allowlist = new Set(
  [...allowlistMatch[1].matchAll(/"([a-z]+\.[a-zA-Z.]+)"/g)].map((m) => m[1]),
);

const hostSrc = fs.readFileSync(serverTs, "utf-8");
const hostMethods = new Set(
  [...hostSrc.matchAll(/^\s{4}"([a-z]+\.[a-zA-Z.]+)":/gm)].map((m) => m[1]),
);

const missingFromAllowlist = [...rendererMethods].filter((m) => !allowlist.has(m)).sort();
const allowlistedButNotImplemented = [...allowlist].filter((m) => !hostMethods.has(m)).sort();
// This allowlist gates only renderer -> host_rpc calls. Host methods not used
// by the renderer do not belong here: every surplus entry expands XSS reach.
const unusedAllowlistEntries = [...allowlist].filter((m) => !rendererMethods.has(m)).sort();

let fail = false;
if (unresolvedRendererCalls.length > 0) {
  fail = true;
  console.error(
    `renderer contains RPC calls whose methods are not statically auditable:\n  ${unresolvedRendererCalls.join("\n  ")}`,
  );
}
if (missingFromAllowlist.length > 0) {
  fail = true;
  console.error(
    `renderer calls methods missing from the Rust allowlist (will be rejected):\n  ${missingFromAllowlist.join("\n  ")}`,
  );
}
if (allowlistedButNotImplemented.length > 0) {
  fail = true;
  console.error(
    `allowlist references methods the Host does not implement:\n  ${allowlistedButNotImplemented.join("\n  ")}`,
  );
}
if (unusedAllowlistEntries.length > 0) {
  fail = true;
  console.error(
    `allowlist entries not called by the renderer (unnecessary XSS reach):\n  ${unusedAllowlistEntries.join("\n  ")}`,
  );
}
if (!fail) {
  console.log(
    `desktop allowlist OK: ${allowlist.size} methods, all renderer calls (${rendererMethods.size}) allowed and implemented`,
  );
}
process.exit(fail ? 1 : 0);
