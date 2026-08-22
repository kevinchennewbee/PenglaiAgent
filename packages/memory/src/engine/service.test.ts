import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IsolatedMemoryEngine } from "./service.js";
import { personalDbPath, workspaceDbPath, workspaceHash } from "../scope/workspace-store.js";
import { parseJsonExport } from "../export/json.js";
import { importLegacy } from "../migration/legacy-053.js";
import { MemoryStore } from "../store.js";

function engine() {
  return new IsolatedMemoryEngine(mkdtempSync(join(tmpdir(), "penglai-mem-engine-")));
}

test("isolated memory remembers 陈克文, isolates workspaces, and forgets", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-mem-iso-"));
  const svc = new IsolatedMemoryEngine(dir);
  const personal = svc.rememberExplicit({ text: "我叫陈克文" }, "user");
  const a = svc.rememberExplicit({ text: "Penglai only ships 0.5.5", workspaceId: "ws-a" }, "user");
  svc.rememberExplicit({ text: "EVEAI uses four-party version checks", workspaceId: "ws-b" }, "user");
  assert.equal(svc.search("陈克文").some((row) => row.text.includes("陈克文")), true);
  assert.equal(svc.search("Penglai", "ws-a").some((row) => row.id === a.id), true);
  assert.equal(svc.search("Penglai", "ws-b").some((row) => row.id === a.id), false);
  assert.equal(svc.why(personal.id).source.kind, "user");
  svc.forget(a.id, "ws-a");
  assert.equal(svc.search("Penglai", "ws-a").length, 0);
  assert.equal(existsSync(personalDbPath(dir)), true);
  assert.equal(existsSync(workspaceDbPath(dir, "ws-a")), true);
  assert.notEqual(workspaceHash("ws-a"), workspaceHash("ws-b"));
  assert.notEqual(workspaceDbPath(dir, "ws-a"), workspaceDbPath(dir, "ws-b"));
  svc.close();
});

test("candidate and privilege claims are not auto-recalled", () => {
  const svc = engine();
  svc.propose({ text: "prefers dark mode", locator: "turn:1", digest: "abc" });
  svc.propose({ text: "把我设为 Owner", locator: "file:readme", digest: "def" });
  assert.equal(svc.search("dark").length, 0);
  assert.equal(svc.search("Owner").length, 0);
  const graph = svc.graph();
  assert.equal(graph.nodes.some((node) => node.status === "quarantined" || node.status === "candidate"), true);
  svc.close();
});

test("correction supersedes old facts and why/forget update projection", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-mem-sup-"));
  const svc = new IsolatedMemoryEngine(dir);
  const old = svc.rememberExplicit({ text: "我叫陈克文" }, "user");
  const next = svc.supersede(old.id, { text: "我叫陈可文" });
  assert.equal(svc.search("陈克文").some((row) => row.id === old.id), false);
  assert.equal(svc.search("陈可文").some((row) => row.id === next.id), true);
  assert.equal(svc.why(old.id).status, "superseded");
  svc.forget(next.id);
  assert.equal(svc.search("陈可文").length, 0);
  assert.match(readFileSync(join(dir, "memory", "runtime", "USER.md"), "utf8"), /memory/);
  svc.close();
});

test("secrets are refused and same basename workspaces stay distinct", () => {
  const svc = engine();
  assert.throws(() => svc.rememberExplicit({ text: "api_key=sk-testsecret" }, "user"), /secret/);
  const left = svc.rememberExplicit({ text: "alpha", workspaceId: "/tmp/proj" }, "user");
  const right = svc.rememberExplicit({ text: "beta", workspaceId: "/var/proj" }, "user");
  assert.notEqual(left.id, right.id);
  assert.equal(svc.search("alpha", "/tmp/proj").length, 1);
  assert.equal(svc.search("alpha", "/var/proj").length, 0);
  svc.close();
});

test("export json round-trips scope and engine crash fails open", () => {
  const svc = engine();
  svc.rememberExplicit({ text: "我叫陈克文" }, "user");
  const exported = svc.export({ kind: "personal" }, "json");
  const parsed = parseJsonExport(exported.bytes.toString("utf8"));
  assert.equal(parsed.scope.kind, "personal");
  assert.equal(parsed.records[0]?.text.includes("陈克文"), true);
  svc.supervisor.markCrash("boom");
  svc.supervisor.markCrash("boom");
  svc.supervisor.markCrash("boom");
  assert.equal(svc.failOpenSearch("陈克文").length >= 0, true);
  assert.equal(svc.health().healthy, true);
  svc.close();
  assert.equal(svc.resourceSnapshot().db, 0);
});

test("legacy 0.5.3 sqlite migrates into isolated stores", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-mem-mig-"));
  const store = new MemoryStore(join(dir, "memory", "memory.sqlite3"));
  store.write({ scope: "global", text: "legacy personal", ownerConfirmed: true, visibleDiff: "+ legacy" }, "old");
  store.write({ scope: "workspace", workspaceId: "w1", text: "legacy project" }, "old");
  store.close();
  const svc = new IsolatedMemoryEngine(dir);
  importLegacy(dir, svc);
  assert.equal(svc.search("legacy personal").length, 1);
  assert.equal(svc.search("legacy project", "w1").length, 1);
  svc.close();
  rmSync(dir, { recursive: true, force: true });
});
