import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { readProcessPgid, readProcessStartMs, reapDshOrphans } from "./process.js";
import type { RuntimeLayout, UserLayout } from "./index.js";

test("darwin process identity queries return for a live pid without blocking", { skip: process.platform !== "darwin" }, () => {
  const started = Date.now();
  const startMs = readProcessStartMs(process.pid);
  const pgid = readProcessPgid(process.pid);
  assert.ok(startMs > 0);
  assert.ok(pgid > 0);
  assert.ok(Date.now() - started < 1_000, "process identity queries must stay bounded");
});

test("orphan cleanup preserves another data root using the same executable and entry", { skip: process.platform !== "darwin" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-process-scope-"));
  const entry = join(root, "owned-test-entry.mjs");
  const own = join(root, "own");
  const other = join(root, "other");
  mkdirSync(own); mkdirSync(other);
  writeFileSync(entry, 'process.stdout.write("ready"); setInterval(() => {}, 1000);');
  const children = [own, other].map((cwd) => spawn(process.execPath, [entry], { cwd, stdio: ["ignore", "pipe", "ignore"] }));
  try {
    await Promise.all(children.map((child) => once(child.stdout!, "data")));
    const layout = { nodeBin: process.execPath, dshEntry: entry } as RuntimeLayout;
    assert.deepEqual(reapDshOrphans(layout), []);
    const killed = reapDshOrphans(layout, undefined, { dshHome: own } as UserLayout);
    assert.deepEqual(killed.map((row) => row.pid), [children[0]!.pid]);
    assert.doesNotThrow(() => process.kill(children[1]!.pid!, 0));
  } finally {
    for (const child of children) child.kill("SIGKILL");
  }
});
