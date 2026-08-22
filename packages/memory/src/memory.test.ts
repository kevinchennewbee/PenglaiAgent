import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  apply,
  assertReadable,
  createMemoryService,
  modelCannotWriteGlobal,
  GLOBAL_L1_MAX_BYTES,
  GLOBAL_L1_MAX_ROWS,
} from "./index.js";
import { MemoryStore } from "./store.js";
import { createMemorySettingsApi } from "./remote.js";

test("shipped memory remembers, isolates workspaces, and forgets", () => {
  const svc = createMemoryService();
  const personal = svc.rememberExplicit({ text: "我叫陈克文" });
  const a = svc.rememberExplicit({ text: "Penglai only ships 0.5.5", workspaceId: "ws-a" });
  svc.rememberExplicit({ text: "EVEAI uses four-party version checks", workspaceId: "ws-b" });
  assert.equal(svc.search("陈克文").some((row) => row.text.includes("陈克文")), true);
  assert.equal(svc.search("Penglai", "ws-a").some((row) => row.id === a.id), true);
  assert.equal(svc.search("Penglai", "ws-b").some((row) => row.id === a.id), false);
  assert.equal(svc.why(personal.id ?? 0).source, "user-explicit");
  svc.forget(a.id ?? 0, "ws-a");
  assert.equal(svc.search("Penglai", "ws-a").length, 0);
  assert.equal(svc.search("陈克文").some((row) => row.id === personal.id), true);
});

test("Memory isolates Workspace scope and requires Owner confirm for global/SOP", () => {
  const svc = createMemoryService();
  assert.throws(() => assertReadable("workspace", "w1", "w2"), /isolation/);
  assert.doesNotThrow(() => assertReadable("workspace", "w1", "w1"));
  assert.throws(() => svc.write({ scope: "global", text: "x" }), /Owner confirm/);
  assert.deepEqual(svc.write({ scope: "global", text: "x", ownerConfirmed: true, visibleDiff: "+ x" }), { ok: true, viaOfficialSkill: false, id: 1 });
  assert.deepEqual(svc.write({ scope: "global", text: "sop", ownerConfirmed: true, visibleDiff: "+ sop", officialSkill: true }), {
    ok: true,
    viaOfficialSkill: true,
    id: 2,
  });
  assert.throws(() => modelCannotWriteGlobal(), /cannot write global/);
});

test("R50-CTXMEM: memory persists across restart with scope isolation and layered delete", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-mem-"));
  const dbPath = join(dir, "memory.sqlite3");
  {
    const store = new MemoryStore(dbPath);
    store.write({ scope: "global", text: "prefers concise answers", ownerConfirmed: true, visibleDiff: "+ prefers" }, "owner-ui");
    store.write({ scope: "workspace", workspaceId: "w1", text: "project uses pnpm" }, "auto-candidate");
    store.write({ scope: "workspace", workspaceId: "w2", text: "other workspace fact" }, "auto-candidate");
    store.write({ scope: "candidate", workspaceId: "w1", text: "candidate summary" }, "turn-42");
    store.close();
  }
  assert.equal(existsSync(dbPath), true);
  {
    const store = new MemoryStore(dbPath);
    const g = store.readForSession("w1");
    assert.equal(g.global.length, 1);
    assert.equal(g.workspace.length, 1);
    assert.equal(g.workspace[0]?.text, "project uses pnpm");
    const floating = store.readForSession(undefined);
    assert.equal(floating.global.length, 1);
    assert.equal(floating.workspace.length, 0, "floating session must not read any workspace memory");
    const other = store.readForSession("w2");
    assert.equal(other.workspace[0]?.text, "other workspace fact", "workspaces must not cross-read");
    const removed = store.deleteScope("workspace", "w1");
    assert.equal(removed, 1);
    assert.equal(store.readForSession("w1").workspace.length, 0);
    assert.equal(store.readForSession("w2").workspace.length, 1, "w2 must survive w1 delete");
    store.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

test("R50-CTXMEM: global L1 enforces row and byte budgets durably", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-mem-budget-"));
  const store = new MemoryStore(join(dir, "memory.sqlite3"));
  for (let i = 0; i < GLOBAL_L1_MAX_ROWS; i += 1) {
    store.write({ scope: "global", text: `g${i}`, ownerConfirmed: true, visibleDiff: `+ g${i}` }, "bulk");
  }
  assert.throws(
    () => store.write({ scope: "global", text: "overflow", ownerConfirmed: true, visibleDiff: "+ overflow" }, "bulk"),
    /row budget/,
  );
  store.close();
  const big = "x".repeat(GLOBAL_L1_MAX_BYTES + 1);
  const store2 = new MemoryStore(join(dir, "memory2.sqlite3"));
  assert.throws(
    () => store2.write({ scope: "global", text: big, ownerConfirmed: true, visibleDiff: "+ big" }, "bulk"),
    /byte budget/,
  );
  store2.close();
  rmSync(dir, { recursive: true, force: true });
});

test("R50-CTXMEM: production apply() wires the durable store under PENGLAI_USER_DATA", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-mem-apply-"));
  const previous = process.env.PENGLAI_USER_DATA;
  process.env.PENGLAI_USER_DATA = dir;
  const ctx = {
    skills: { snapshot: async () => ({ skills: [], complete: true }) },
    workspaceRegistry: { list: () => [{ id: "w1", title: "Workspace" }] },
    provide() {},
  };
  try {
    const svc = apply(ctx);
    svc.write({ scope: "workspace", workspaceId: "w1", text: "durable fact" }, "test");
    svc.close?.();
    const svc2 = apply(ctx);
    const rows = svc2.list("workspace", "w1");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.text, "durable fact");
    svc2.close?.();
  } finally {
    if (previous === undefined) delete process.env.PENGLAI_USER_DATA;
    else process.env.PENGLAI_USER_DATA = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R50-CTXMEM-012 SOP promotion writes the official DSH Skills root and returns a registry receipt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-mem-sop-"));
  const previousUserData = process.env.PENGLAI_USER_DATA;
  const previousDshHome = process.env.DSH_HOME;
  process.env.PENGLAI_USER_DATA = dir;
  process.env.DSH_HOME = join(dir, "dsh-home");
  try {
    const svc = apply({
      skills: {
        snapshot: async () => ({ skills: [{ name: "release-check" }], complete: true }),
      },
      workspaceRegistry: { list: () => [{ id: "w1", title: "Workspace" }] },
      provide() {},
    });
    const receipt = await svc.promoteSop({
      name: "release-check",
      description: "Verify a candidate release",
      body: "Run the project release verifier and report exact failures.",
      visibleDiff: "+ release-check",
      ownerConfirmed: true,
    });
    assert.equal(receipt.registry, "official-dsh-skills");
    assert.equal(receipt.observed, true);
    assert.match(receipt.sha256, /^[0-9a-f]{64}$/);
    assert.equal(existsSync(join(dir, "dsh-home", "skills", "release-check", "SKILL.md")), true);
    svc.close?.();
  } finally {
    if (previousUserData === undefined) delete process.env.PENGLAI_USER_DATA;
    else process.env.PENGLAI_USER_DATA = previousUserData;
    if (previousDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousDshHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Memory settings enforces layered writes, visible diff, and live Workspace scope", () => {
  const svc = createMemoryService();
  const api = createMemorySettingsApi(svc as never, { list: () => [{ id: "w1", title: "Workspace" }] });
  assert.throws(() => api.write({ scope: "candidate", text: "model candidate" }), /pipeline/);
  assert.throws(() => api.write({ scope: "global", text: "global" }), /Owner confirm/);
  assert.equal(api.write({ scope: "global", text: "global", ownerConfirmed: true, visibleDiff: "+ global" }).id, 1);
  assert.equal(api.write({ scope: "workspace", workspaceId: "w1", text: "workspace" }).id, 2);
  assert.throws(() => api.write({ scope: "workspace", workspaceId: "missing", text: "x" }), /not live/);
  assert.equal(api.status({ scope: "workspace", workspaceId: "w1" }).rows.length, 1);
  assert.throws(() => api.deleteScope({ scope: "workspace", workspaceId: "w1", ownerConfirmed: false }), /Owner confirmation/);
  assert.equal(api.deleteScope({ scope: "workspace", workspaceId: "w1", ownerConfirmed: true }).removed, 1);
});

test("Memory client registers the official settings slot without a second skill store", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(source, /settings\.section/);
  assert.match(source, /data-penglai-memory/);
  assert.match(source, /penglaiMemorySettings/);
  assert.match(source, /official-dsh-skills/);
  assert.doesNotMatch(source, /localStorage|indexedDB/);
});

test("production Memory apply refuses in-memory fallback and missing official Skills", () => {
  const previous = process.env.PENGLAI_USER_DATA;
  delete process.env.PENGLAI_USER_DATA;
  try {
    assert.throws(() => apply({ provide() {} }), /PENGLAI_USER_DATA/);
  } finally {
    if (previous !== undefined) process.env.PENGLAI_USER_DATA = previous;
  }
});
