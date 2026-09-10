import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MnemonMemoryService } from "./service.js";
import { personalDataDir, workspaceDataDir } from "./service.js";
import { createTestMnemonBinary } from "./test-binary.js";
import { CANDIDATE_KINDS } from "../v2/governance.js";
import { nativeCategoryForCandidateKind } from "../v2/native-category.js";

const binaryPath = createTestMnemonBinary();

function svc(dir = mkdtempSync(join(tmpdir(), "penglai-mnemon-svc-"))) {
  return new MnemonMemoryService(dir, { binaryPath, allowUnpinnedTestBinary: true });
}

test("mnemon service remembers, isolates workspaces, and forgets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-mnemon-iso-"));
  const memory = new MnemonMemoryService(dir, { binaryPath, allowUnpinnedTestBinary: true });
  const personal = await memory.remember({ text: "我叫测试用户", tags: "identity" });
  await memory.remember({ text: "Penglai only ships 0.5.5", workspaceId: "ws-a", tags: "project" });
  await memory.remember({ text: "workspace B secret fact", workspaceId: "ws-b", tags: "project" });
  const found = await memory.search("测试用户");
  assert.equal(found.some((row) => row.id === personal.id), true);
  const a = await memory.search("Penglai", "ws-a");
  const b = await memory.search("Penglai", "ws-b");
  assert.equal(a.some((row) => row.content.includes("Penglai")), true);
  assert.equal(b.some((row) => row.content.includes("Penglai")), false);
  await memory.forget(personal.id);
  const after = await memory.search("测试用户");
  assert.equal(after.some((row) => row.id === personal.id), false);
  assert.equal(personalDataDir(dir), join(dir, "memory", "mnemon", "personal"));
  assert.notEqual(workspaceDataDir(dir, "ws-a"), workspaceDataDir(dir, "ws-b"));
  const graph = await memory.graph("ws-a");
  assert.equal(Array.isArray(graph.nodes), true);
  memory.close();
});

test("memory library query paginates, searches, and stays inside one Workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-mnemon-lib-"));
  const memory = new MnemonMemoryService(dir, { binaryPath, allowUnpinnedTestBinary: true });
  await memory.remember({ text: "alpha fact about Penglai", workspaceId: "ws-a", tags: "project", source: "turn:1" });
  await memory.remember({ text: "beta secret in B", workspaceId: "ws-b", tags: "project", source: "turn:2" });
  await memory.remember({ text: "personal preference", source: "user" });
  const page = memory.queryLibrary({ q: "Penglai", scope: "workspace", workspaceId: "ws-a", limit: 10, offset: 0 });
  assert.equal(page.total, 1);
  assert.equal(page.rows[0]?.content.includes("Penglai"), true);
  assert.equal(page.rows[0]?.workspaceId, "ws-a");
  const other = memory.queryLibrary({ q: "Penglai", scope: "workspace", workspaceId: "ws-b", limit: 10, offset: 0 });
  assert.equal(other.total, 0);
  assert.throws(() => memory.queryLibrary({ scope: "workspace" }), /official Workspace/);
  memory.close();
});

test("production service rejects an explicit unpinned Mnemon executable", () => {
  assert.throws(
    () => new MnemonMemoryService(mkdtempSync(join(tmpdir(), "penglai-mnemon-pin-")), { binaryPath }),
    /hash mismatch/,
  );
});

test("fake mnemon rejects engine-invalid categories and accepts mapped CandidateKind values", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-mnemon-cat-"));
  const memory = new MnemonMemoryService(dir, { binaryPath, allowUnpinnedTestBinary: true });
  await assert.rejects(
    () => memory.remember({ text: "invalid-project-fact-cat", cat: "project_fact" as never }),
    /UNKNOWN_MNEMON_CATEGORY/,
  );
  await assert.rejects(
    () => memory.remember({ text: "invalid-constraint-cat", cat: "constraint" as never }),
    /UNKNOWN_MNEMON_CATEGORY/,
  );
  await assert.rejects(
    () => memory.remember({ text: "invalid-person-fact-cat", cat: "person_fact" as never }),
    /UNKNOWN_MNEMON_CATEGORY/,
  );
  const rawDir = mkdtempSync(join(tmpdir(), "penglai-mnemon-raw-cat-"));
  assert.ok(memory.runner);
  const raw = await memory.runner.run({
    command: "remember",
    dataDir: rawDir,
    positionals: ["raw invalid category probe"],
    flags: { "--cat": "project_fact" },
  });
  assert.equal(raw.exitCode, 1);
  assert.match(raw.stderr, /invalid category "project_fact"/);
  assert.match(raw.stderr, /valid: preference, decision, fact, insight, context, general/);
  for (const kind of CANDIDATE_KINDS) {
    const cat = nativeCategoryForCandidateKind(kind);
    const row = await memory.remember({
      text: `mapped-${kind}-token`,
      cat,
      workspaceId: "ws-map",
      tags: `kind:${kind}`,
    });
    assert.equal(row.category, cat);
    const hits = await memory.search(`mapped-${kind}-token`, "ws-map");
    assert.equal(hits.some((hit) => hit.id === row.id), true);
    assert.equal((hits.find((hit) => hit.id === row.id) as { category?: string } | undefined)?.category, cat);
  }
  memory.close();
});

test("known-id operations resolve personal scope and reject cross-workspace ids", async () => {
  const memory = svc();
  const personal = await memory.remember({ text: "personal-known-id" });
  const project = await memory.remember({ text: "workspace-known-id", workspaceId: "ws-a" });

  assert.equal((await memory.why(personal.id, "ws-a")).scope, "personal");
  const corrected = await memory.correct(personal.id, "personal-corrected", "ws-a");
  assert.equal((await memory.search("personal-corrected")).some((row) => row.id === corrected.id), true);
  await assert.rejects(() => memory.why(project.id, "ws-b"), /outside the current official Workspace/);
  await assert.rejects(() => memory.forget(project.id, "ws-b"), /outside the current official Workspace/);
  assert.equal((await memory.search("workspace-known-id", "ws-a")).some((row) => row.id === project.id), true);
  await memory.forget(project.id, "ws-a");
  assert.equal((await memory.search("workspace-known-id", "ws-a")).some((row) => row.id === project.id), false);
  memory.close();
});

test("journal why/export/deleteScope do not search star or dot", async () => {
  const memory = svc();
  const row = await memory.remember({ text: "export-row", workspaceId: "ws-a" });
  const why = await memory.why(row.id, "ws-a");
  assert.equal(why.content, "export-row");
  assert.equal(why.recalledBecause, "journal");
  const exported = await memory.export("ws-a");
  assert.equal(exported.rows.some((item) => item.id === row.id), true);
  const removed = await memory.deleteScope("ws-a");
  assert.equal(removed.removed, 1);
  assert.equal((await memory.search("export-row", "ws-a")).length, 0);
  memory.close();
});

test("bounded load writes stay searchable via journal", async () => {
  const memory = svc();
  for (let i = 0; i < 250; i += 1) {
    await memory.remember({ text: `scale-row-${i}`, workspaceId: "ws-load" });
  }
  const found = await memory.search("scale-row-249", "ws-load");
  assert.equal(found.some((row) => row.content.includes("249")), true);
  assert.equal(memory.journal.listActive("workspace", "ws-load").length, 250);
  memory.close();
});

test("mnemon runner refuses write commands when readonly", async () => {
  const memory = new MnemonMemoryService(mkdtempSync(join(tmpdir(), "penglai-mnemon-ro-")), {
    readonly: true,
    binaryPath,
    allowUnpinnedTestBinary: true,
  });
  await assert.rejects(() => memory.remember({ text: "nope" }), /read-only/);
  memory.close();
});
