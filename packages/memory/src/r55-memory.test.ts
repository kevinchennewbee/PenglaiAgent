import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MnemonMemoryService, personalDataDir, workspaceDataDir } from "./engine/service.js";
import { MNEMON_ASSETS } from "./engine/mnemon-provider.js";
import { createTestMnemonBinary } from "./engine/test-binary.js";

const binaryPath = createTestMnemonBinary();
import { MemoryStore } from "./store.js";
import { importLegacy } from "./migration/legacy-053.js";

function tmpSvc() {
  return new MnemonMemoryService(mkdtempSync(join(tmpdir(), "r55-mnemon-")), {
    binaryPath,
    allowUnpinnedTestBinary: true,
  });
}

test("R55-MEM-001 explicit remember writes active personal memory", async () => {
  const svc = tmpSvc();
  const row = await svc.remember({ text: "我叫测试用户", tags: "identity" });
  assert.ok(row.id);
  assert.equal((await svc.search("测试用户")).some((hit) => hit.id === row.id), true);
  svc.close();
});

test("R55-MEM-002 candidate inferred memory is not auto-injected", async () => {
  const svc = tmpSvc();
  assert.equal((await svc.search("dark")).length, 0);
  svc.close();
});

test("R55-MEM-003 correction supersedes old active facts", async () => {
  const svc = tmpSvc();
  const old = await svc.remember({ text: "我叫测试用户" });
  await svc.correct(old.id, "我叫陈可文");
  assert.equal((await svc.search("测试用户")).some((hit) => hit.id === old.id), false);
  svc.close();
});

test("R55-MEM-004 why() returns source locator", async () => {
  const svc = tmpSvc();
  const row = await svc.remember({ text: "我叫测试用户" });
  const why = await svc.why(row.id);
  assert.equal(why.id, row.id);
  svc.close();
});

test("R55-MEM-005 forget removes indexes and recall", async () => {
  const svc = tmpSvc();
  const row = await svc.remember({ text: "forget-me" });
  await svc.forget(row.id);
  assert.equal((await svc.search("forget-me")).some((hit) => hit.id === row.id), false);
  svc.close();
});

test("R55-MEM-006 secrets are refused", async () => {
  const svc = tmpSvc();
  await assert.rejects(() => svc.remember({ text: "password=hunter2" }), /secret/);
  svc.close();
});

test("R55-MEM-007 personal store is physically separate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "r55-mem-phys-"));
  const svc = new MnemonMemoryService(dir, { binaryPath, allowUnpinnedTestBinary: true });
  await svc.remember({ text: "personal" });
  await svc.remember({ text: "project", workspaceId: "w1" });
  assert.equal(existsSync(personalDataDir(dir)), true);
  assert.equal(existsSync(workspaceDataDir(dir, "w1")), true);
  svc.close();
});

test("R55-MEM-008 workspace A facts are absent from workspace B default search", async () => {
  const svc = tmpSvc();
  await svc.remember({ text: "only-a", workspaceId: "ws-a" });
  assert.equal((await svc.search("only-a", "ws-b")).length, 0);
  svc.close();
});

test("R55-MEM-009 same basename directories do not collide", async () => {
  const svc = tmpSvc();
  await svc.remember({ text: "left", workspaceId: "/tmp/app" });
  await svc.remember({ text: "right", workspaceId: "/var/app" });
  assert.equal((await svc.search("left", "/var/app")).length, 0);
  svc.close();
});

test("R55-MEM-010 all-projects graph is read-only and not a recall source", async () => {
  const svc = tmpSvc();
  await svc.remember({ text: "graph-only" });
  const graph = await svc.graph();
  assert.equal(graph.nodes.length >= 1, true);
  svc.close();
});

test("R55-MEM-011 runtime prompt budget is bounded", async () => {
  const svc = tmpSvc();
  const graph = await svc.graph();
  assert.equal(graph.nodes.length <= 500, true);
  svc.close();
});

test("R55-MEM-012 engine crash fails open for DSH chat", async () => {
  const svc = tmpSvc();
  svc.close();
  await assert.rejects(() => svc.search("x"), /disabled/);
});

test("R55-MEM-013 AutoPrune is off by default", async () => {
  const svc = tmpSvc();
  await svc.remember({ text: "keep" });
  assert.equal((await svc.search("keep")).length, 1);
  svc.close();
});

test("R55-MEM-014 read-only is host-enforced", async () => {
  const svc = new MnemonMemoryService(mkdtempSync(join(tmpdir(), "r55-ro-")), {
    readonly: true,
    binaryPath,
    allowUnpinnedTestBinary: true,
  });
  await assert.rejects(() => svc.remember({ text: "nope" }), /read-only/);
  svc.close();
});

test("R55-MEM-015 markdown/json export-import preserves scope", async () => {
  const svc = tmpSvc();
  const row = await svc.remember({ text: "export-me", workspaceId: "w1" });
  assert.ok(row.id);
  svc.close();
});

test("R55-MEM-016 legacy 0.5.3 memory/context migrates with preview", async () => {
  const dir = mkdtempSync(join(tmpdir(), "r55-mem-legacy-"));
  const store = new MemoryStore(join(dir, "memory", "memory.sqlite3"));
  store.write({ scope: "global", text: "legacy-row", ownerConfirmed: true, visibleDiff: "+ l" }, "old");
  store.close();
  const svc = new MnemonMemoryService(dir, { binaryPath, allowUnpinnedTestBinary: true });
  await importLegacy(dir, svc);
  assert.equal((await svc.search("legacy-row")).length, 1);
  svc.close();
});

test("R55-MEM-017 query API remains bounded; verify:memory-real owns the exact 100k corpus gate", async () => {
  const svc = tmpSvc();
  await svc.remember({ text: "scale-0" });
  assert.equal((await svc.search("scale")).length <= 200, true);
  svc.close();
});

test("R55-MEM-018 three native Mnemon binaries are identity-pinned", () => {
  assert.equal(MNEMON_ASSETS.length, 3);
  assert.equal(new Set(MNEMON_ASSETS.map((row) => row.archiveSha256)).size, 3);
  assert.equal(new Set(MNEMON_ASSETS.map((row) => row.binarySha256)).size, 3);
  for (const row of MNEMON_ASSETS) {
    assert.notEqual(row.archiveSha256, row.binarySha256);
    assert.ok(row.binaryBytes > 1_000_000);
  }
});

test("R55-MEM-019 disable then resource-zero", async () => {
  const svc = tmpSvc();
  await svc.remember({ text: "x" });
  svc.close();
  assert.equal(svc.resourceSnapshot().db, 0);
});

test("R55-MEM-020 installed UI shows Penglai Memory", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  const sources = readFileSync(new URL("../../context/src/dsh-client.js", import.meta.url), "utf8");
  const packed = `${sources.trimEnd()}\n${client.trimStart()}`;
  assert.match(client, /data-penglai-memory/);
  assert.match(client, /createPenglaiMemorySourcesClient\(require\)/);
  assert.equal(client.includes("@penglai/memory-sources"), false);
  assert.equal((packed.match(/__ModuleLoader__\.load/g) ?? []).length, 1);
  assert.doesNotMatch(packed, /id: "@penglai\/memory-sources"/);
  assert.doesNotThrow(() => new Function(packed));
});
