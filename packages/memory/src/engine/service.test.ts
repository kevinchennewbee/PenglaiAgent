import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MnemonMemoryService } from "./service.js";
import { personalDataDir, workspaceDataDir } from "./service.js";
import { createTestMnemonBinary } from "./test-binary.js";

const binaryPath = createTestMnemonBinary();

function svc(dir = mkdtempSync(join(tmpdir(), "penglai-mnemon-svc-"))) {
  return new MnemonMemoryService(dir, { binaryPath });
}

test("mnemon service remembers, isolates workspaces, and forgets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-mnemon-iso-"));
  const memory = new MnemonMemoryService(dir, { binaryPath });
  const personal = await memory.remember({ text: "我叫陈克文", tags: "identity" });
  await memory.remember({ text: "Penglai only ships 0.5.5", workspaceId: "ws-a", tags: "project" });
  await memory.remember({ text: "workspace B secret fact", workspaceId: "ws-b", tags: "project" });
  const found = await memory.search("陈克文");
  assert.equal(found.some((row) => row.id === personal.id), true);
  const a = await memory.search("Penglai", "ws-a");
  const b = await memory.search("Penglai", "ws-b");
  assert.equal(a.some((row) => row.content.includes("Penglai")), true);
  assert.equal(b.some((row) => row.content.includes("Penglai")), false);
  await memory.forget(personal.id);
  const after = await memory.search("陈克文");
  assert.equal(after.some((row) => row.id === personal.id), false);
  assert.match(personalDataDir(dir), /memory\/mnemon\/personal/);
  assert.notEqual(workspaceDataDir(dir, "ws-a"), workspaceDataDir(dir, "ws-b"));
  const graph = await memory.graph("ws-a");
  assert.equal(Array.isArray(graph.nodes), true);
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
  const memory = new MnemonMemoryService(mkdtempSync(join(tmpdir(), "penglai-mnemon-ro-")), { readonly: true, binaryPath });
  await assert.rejects(() => memory.remember({ text: "nope" }), /read-only/);
  memory.close();
});
