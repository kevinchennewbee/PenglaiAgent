import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MnemonMemoryService } from "./service.js";
import { personalDataDir, workspaceDataDir } from "./service.js";

function svc() {
  return new MnemonMemoryService(mkdtempSync(join(tmpdir(), "penglai-mnemon-svc-")));
}

test("mnemon service remembers, isolates workspaces, and forgets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-mnemon-iso-"));
  const memory = new MnemonMemoryService(dir);
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

test("mnemon runner refuses write commands when readonly", async () => {
  const memory = new MnemonMemoryService(mkdtempSync(join(tmpdir(), "penglai-mnemon-ro-")), { readonly: true });
  await assert.rejects(() => memory.remember({ text: "nope" }), /read-only/);
  memory.close();
});
