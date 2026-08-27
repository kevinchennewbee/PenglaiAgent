import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { locateWorkspaceDsh } from "./dsh-closure.mjs";

test("locateWorkspaceDsh uses hoisted node_modules when .pnpm has no DSH entry", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-hoist-"));
  mkdirSync(join(root, "node_modules", ".pnpm"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".pnpm", "lock.yaml"), "lockfileVersion: 9.0\n");
  const dshDir = join(root, "node_modules", "@deepseek-ai", "dsh");
  mkdirSync(dshDir, { recursive: true });
  writeFileSync(join(dshDir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.1.1-rc.2" }));
  const located = locateWorkspaceDsh({
    root,
    pinnedVersion: "0.1.1-rc.2",
    resolvedPackageDir: dshDir,
  });
  assert.equal(located?.layout, "hoisted");
  assert.equal(located?.dshPackageDir, dshDir);
  assert.equal(located?.dshPackageRoot, root);
});

test("locateWorkspaceDsh prefers isolated .pnpm virtual store when present", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-dsh-iso-"));
  const virtual = join(root, "node_modules", ".pnpm", "@deepseek-ai+dsh@0.1.1-rc.2_abc");
  const nested = join(virtual, "node_modules", "@deepseek-ai", "dsh");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.1.1-rc.2" }));
  const located = locateWorkspaceDsh({
    root,
    pinnedVersion: "0.1.1-rc.2",
    resolvedPackageDir: join(root, "node_modules", "@deepseek-ai", "dsh"),
  });
  assert.equal(located?.layout, "isolated");
  assert.equal(located?.dshPackageDir, nested);
  assert.equal(located?.dshPackageRoot, virtual);
});
