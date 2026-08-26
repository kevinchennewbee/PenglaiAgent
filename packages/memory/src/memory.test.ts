import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  apply,
  assertReadable,
  createDurableMemoryService,
  createMemoryService,
  modelCannotWriteGlobal,
  GLOBAL_L1_MAX_BYTES,
  GLOBAL_L1_MAX_ROWS,
} from "./index.js";
import { OwnerApprovalBroker } from "@penglai/runtime";
import { MemoryStore } from "./store.js";
import { createMemorySettingsApi } from "./remote.js";

const inertAgents = {
  get: () => undefined,
  create: async () => {
    throw new Error("not used by this test");
  },
};

test("shipped memory remembers, isolates workspaces, and forgets", () => {
  const svc = createMemoryService();
  const personal = svc.rememberExplicit({ text: "我叫测试用户" });
  const a = svc.rememberExplicit({ text: "Penglai only ships 0.5.5", workspaceId: "ws-a" });
  svc.rememberExplicit({ text: "EVEAI uses four-party version checks", workspaceId: "ws-b" });
  assert.equal(svc.search("测试用户").some((row) => row.text.includes("测试用户")), true);
  assert.equal(svc.search("Penglai", "ws-a").some((row) => row.id === a.id), true);
  assert.equal(svc.search("Penglai", "ws-b").some((row) => row.id === a.id), false);
  assert.equal(svc.why(personal.id ?? 0).source, "user-explicit");
  svc.forget(a.id ?? 0, "ws-a");
  assert.equal(svc.search("Penglai", "ws-a").length, 0);
  assert.equal(svc.search("测试用户").some((row) => row.id === personal.id), true);
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

test("R50-CTXMEM: production apply() wires app-private state and fails closed without a bundled Mnemon", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-mem-apply-"));
  const previous = process.env.PENGLAI_USER_DATA;
  const previousBin = process.env.PENGLAI_MNEMON_BINARY;
  process.env.PENGLAI_USER_DATA = dir;
  delete process.env.PENGLAI_MNEMON_BINARY;
  const ctx = {
    skills: { snapshot: async () => ({ skills: [], complete: true }) },
    workspaceRegistry: { list: () => [{ id: "w1", title: "Workspace" }] },
    agents: inertAgents,
    tools: { register() {} },
    provide() {},
  };
  try {
    const svc = apply(ctx);
    assert.equal(svc.engine.degraded, true);
    assert.equal(svc.engine.degradeReason, "mnemon binary missing");
    await assert.rejects(() => svc.remember({ text: "durable fact", workspaceId: "w1" }), /mnemon binary missing/);
    assert.equal(existsSync(join(dir, "memory", "journal.sqlite3")), true);
    svc.close?.();
  } finally {
    if (previous === undefined) delete process.env.PENGLAI_USER_DATA;
    else process.env.PENGLAI_USER_DATA = previous;
    if (previousBin === undefined) delete process.env.PENGLAI_MNEMON_BINARY;
    else process.env.PENGLAI_MNEMON_BINARY = previousBin;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R50-CTXMEM-012 SOP promotion requires Broker approval and writes the official DSH Skills root", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-mem-sop-"));
  const previousUserData = process.env.PENGLAI_USER_DATA;
  const previousDshHome = process.env.DSH_HOME;
  process.env.PENGLAI_USER_DATA = dir;
  process.env.DSH_HOME = join(dir, "dsh-home");
  try {
    const owner = new OwnerApprovalBroker(dir, { dialog: async () => "approved" });
    const svc = createDurableMemoryService({
      userData: dir,
      skills: {
        snapshot: async () => ({ skills: [{ name: "release-check" }], complete: true }),
      },
      owner,
    });
    const description = "Verify a candidate release";
    const body = "Run the project release verifier and report exact failures.";
    const proposal = svc.proposeAction({
      action: "memory.promote-sop",
      objectId: "skill:release-check",
      sourceText: JSON.stringify({ name: "release-check", description, body }),
    });
    const approved = await owner.requestOwnerApproval(proposal.actionId);
    assert.equal(approved.decision, "approved");
    if (approved.decision !== "approved") throw new Error("expected approval");
    const receipt = await svc.promoteSop({
      name: "release-check",
      description,
      body,
      visibleDiff: "+ release-check",
      ownerConfirmed: true,
      actionId: proposal.actionId,
      receipt: approved.receipt,
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

test("Memory settings enforces Broker-gated personal writes and live Workspace scope", async () => {
  const svc = createMemoryService();
  const api = createMemorySettingsApi(svc as never, { list: () => [{ id: "w1", title: "Workspace" }] });
  await assert.rejects(() => api.write({ scope: "candidate", text: "model candidate" }), /pipeline/);
  await assert.rejects(() => api.write({ scope: "global", text: "global" }), /broker receipt/);
  await assert.rejects(
    () => api.write({ scope: "global", text: "global", actionId: "a", receipt: "b.c" }),
    /Owner path unavailable/,
  );
  const workspace = await api.write({ scope: "workspace", workspaceId: "w1", text: "workspace" });
  assert.equal(workspace.id, 1);
  await assert.rejects(() => api.write({ scope: "workspace", workspaceId: "missing", text: "x" }), /not live/);
  await assert.rejects(() => api.deleteScope({ scope: "workspace", workspaceId: "w1", ownerConfirmed: false }), /broker receipt/);
});

test("Memory exposes authorized sources through its one settings Remote", async () => {
  const calls: string[] = [];
  const sources = {
    status() { calls.push("status"); return { grants: [], workspaces: [] }; },
    ingestCapability() { calls.push("ingest"); return { indexed: 1 }; },
    reindex() { calls.push("reindex"); return { indexed: 1 }; },
    revoke() { calls.push("revoke"); return { sourceUntouched: true }; },
    search() { calls.push("search"); return []; },
  };
  const service = {
    ...createMemoryService(),
    async revokeSource(root: string, proof: { actionId: string; receipt: string }) {
      assert.equal(root, "/authorized");
      assert.deepEqual(proof, { actionId: "action", receipt: "receipt" });
      return sources.revoke();
    },
  };
  const api = createMemorySettingsApi(service as never, { list: () => [{ id: "w1", title: "Workspace" }] }, sources);
  assert.deepEqual(api.sourcesStatus(), { grants: [], workspaces: [] });
  assert.deepEqual(api.sourcesIngestCapability({ capabilityRef: "opaque", scope: "global" }), { indexed: 1 });
  assert.deepEqual(api.sourcesReindex({ root: "/authorized" }), { indexed: 1 });
  await assert.rejects(() => api.sourcesRevoke({ root: "/authorized" }), /broker receipt/);
  assert.deepEqual(await api.sourcesRevoke({ root: "/authorized", actionId: "action", receipt: "receipt" }), { sourceUntouched: true });
  assert.deepEqual(api.sourcesSearch({ query: "hello" }), []);
  assert.deepEqual(calls, ["status", "ingest", "reindex", "revoke", "search"]);
});

test("Memory client registers the official settings slot without a second skill store", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(source, /settings\.section/);
  assert.match(source, /data-penglai-memory/);
  assert.match(source, /data-penglai-memory-sources/);
  assert.match(source, /embedded: true/);
  assert.match(source, /记忆来源/);
  assert.match(source, /penglaiMemorySettings/);
  assert.match(source, /sourcesStatus/);
  assert.doesNotMatch(source, /penglaiMemorySourcesSettings/);
  assert.doesNotMatch(source, /@penglai\/context|个人上下文|Personal Context/);
  assert.match(source, /official-dsh-skills/);
  assert.match(source, /data-penglai-memory-mode/);
  assert.match(source, /Candidates do not affect answers/);
  assert.match(source, /还没有进入记忆，也不会影响回答/);
  assert.match(source, /Ask me first/);
  assert.match(source, /先询问我/);
  assert.match(source, /Smart organize \(recommended\)/);
  assert.match(source, /智能整理（推荐）/);
  assert.match(source, /memory.correct/);
  assert.match(source, /acceptCandidate/);
  assert.match(source, /data-penglai-memory-provenance/);
  assert.doesNotMatch(source, /ownerConfirmed: true/);
  assert.doesNotMatch(source, /localStorage|indexedDB/);
});

test("R56-MEM-016 settings status lists real rows and does not invent search words", async () => {
  const svc = createMemoryService();
  svc.write({ scope: "workspace", workspaceId: "w1", text: "official DSH remains the only core" });
  const api = createMemorySettingsApi(svc as never, { list: () => [{ id: "w1", title: "Workspace" }] });
  const status = await api.status({ scope: "workspace", workspaceId: "w1" });
  assert.equal(status.rows.some((row) => String(row.text).includes("official DSH")), true);
  assert.equal(status.rows.some((row) => String(row.text) === "project" || String(row.text) === "identity"), false);
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
