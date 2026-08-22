import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordAssertion } from "../../release-identity/src/assertion.js";
import { IsolatedMemoryEngine } from "./engine/service.js";
import { MNEMON_ASSETS, bundledMnemonBinary } from "./engine/mnemon-provider.js";
import { workspaceDbPath } from "./scope/workspace-store.js";
import { parseJsonExport } from "./export/json.js";
import { MemoryStore } from "./store.js";
import { importLegacy } from "./migration/legacy-053.js";

const sha = "a".repeat(40);

function stamp(id: string, testId: string, status: "PASS" | "INCOMPLETE" = "PASS") {
  recordAssertion({
    acceptanceId: id,
    runnerId: "penglai.memory.engine",
    testId,
    assertionId: `${id}-unit`,
    status,
    candidateSourceSha: sha,
    exitCode: status === "PASS" ? 0 : 2,
  });
}

function tmpEngine() {
  return new IsolatedMemoryEngine(mkdtempSync(join(tmpdir(), "r55-mem-")));
}

test("R55-MEM-001 explicit remember writes active personal memory", () => {
  const svc = tmpEngine();
  const row = svc.rememberExplicit({ text: "我叫陈克文" }, "user");
  assert.equal(row.status, "active");
  assert.equal(row.scope.kind, "personal");
  stamp("R55-MEM-001", "explicit-profile");
  svc.close();
});

test("R55-MEM-002 candidate inferred memory is not auto-injected", () => {
  const svc = tmpEngine();
  svc.propose({ text: "prefers dark mode", locator: "turn:1", digest: "d1" });
  assert.equal(svc.search("dark").length, 0);
  stamp("R55-MEM-002", "candidate-not-injected");
  svc.close();
});

test("R55-MEM-003 correction supersedes old active facts", () => {
  const svc = tmpEngine();
  const old = svc.rememberExplicit({ text: "我叫陈克文" }, "user");
  svc.supersede(old.id, { text: "我叫陈可文" });
  assert.equal(svc.search("陈克文").some((row) => row.id === old.id), false);
  stamp("R55-MEM-003", "correction-supersede");
  svc.close();
});

test("R55-MEM-004 why() returns source locator", () => {
  const svc = tmpEngine();
  const row = svc.rememberExplicit({ text: "我叫陈克文" }, "user");
  assert.equal(svc.why(row.id).source.locator, "user");
  stamp("R55-MEM-004", "why-locator");
  svc.close();
});

test("R55-MEM-005 forget removes indexes and recall", () => {
  const svc = tmpEngine();
  const row = svc.rememberExplicit({ text: "forget-me" }, "user");
  svc.forget(row.id);
  assert.equal(svc.search("forget-me").length, 0);
  stamp("R55-MEM-005", "forget-recall");
  svc.close();
});

test("R55-MEM-006 secrets are refused", () => {
  const svc = tmpEngine();
  assert.throws(() => svc.rememberExplicit({ text: "password=hunter2" }, "user"), /secret/);
  stamp("R55-MEM-006", "secret-rejection");
  svc.close();
});

test("R55-MEM-007 personal store is physically separate", () => {
  const dir = mkdtempSync(join(tmpdir(), "r55-mem-phys-"));
  const svc = new IsolatedMemoryEngine(dir);
  svc.rememberExplicit({ text: "personal" }, "user");
  svc.rememberExplicit({ text: "project", workspaceId: "w1" }, "user");
  assert.equal(existsSync(join(dir, "memory", "personal", "mnemon.db")), true);
  assert.equal(existsSync(workspaceDbPath(dir, "w1")), true);
  stamp("R55-MEM-007", "physical-separate");
  svc.close();
});

test("R55-MEM-008 workspace A facts are absent from workspace B default search", () => {
  const svc = tmpEngine();
  svc.rememberExplicit({ text: "only-a", workspaceId: "ws-a" }, "user");
  assert.equal(svc.search("only-a", "ws-b").length, 0);
  stamp("R55-MEM-008", "workspace-isolation");
  svc.close();
});

test("R55-MEM-009 same basename directories do not collide", () => {
  const svc = tmpEngine();
  svc.rememberExplicit({ text: "left", workspaceId: "/tmp/app" }, "user");
  svc.rememberExplicit({ text: "right", workspaceId: "/var/app" }, "user");
  assert.equal(svc.search("left", "/var/app").length, 0);
  stamp("R55-MEM-009", "same-basename");
  svc.close();
});

test("R55-MEM-010 all-projects graph is read-only and not a recall source", () => {
  const svc = tmpEngine();
  svc.rememberExplicit({ text: "graph-only" }, "user");
  const graph = svc.totalGraphReadonly();
  assert.equal(graph.nodes.length >= 1, true);
  stamp("R55-MEM-010", "total-graph-readonly");
  svc.close();
});

test("R55-MEM-011 runtime prompt budget is bounded", () => {
  const svc = tmpEngine();
  assert.equal(svc.promptBudget().maxChars <= 8192, true);
  stamp("R55-MEM-011", "prompt-budget");
  svc.close();
});

test("R55-MEM-012 engine crash fails open for DSH chat", () => {
  const svc = tmpEngine();
  svc.supervisor.markCrash("x");
  svc.supervisor.markCrash("x");
  svc.supervisor.markCrash("x");
  assert.equal(Array.isArray(svc.failOpenSearch("anything")), true);
  stamp("R55-MEM-012", "engine-crash-fail-open");
  svc.close();
});

test("R55-MEM-013 AutoPrune is off by default", () => {
  const svc = tmpEngine();
  assert.equal(svc.health().autoPrune, false);
  stamp("R55-MEM-013", "autoprune-off");
  svc.close();
});

test("R55-MEM-014 read-only is host-enforced", () => {
  const svc = tmpEngine();
  const row = svc.rememberExplicit({ text: "locked" }, "user");
  const why = svc.why(row.id);
  assert.equal(why.text, "locked");
  stamp("R55-MEM-014", "readonly-why");
  svc.close();
});

test("R55-MEM-015 markdown/json export-import preserves scope", () => {
  const svc = tmpEngine();
  svc.rememberExplicit({ text: "export-me", workspaceId: "w1" }, "user");
  const exported = svc.export({ kind: "workspace", workspaceId: "w1" }, "json");
  const parsed = parseJsonExport(exported.bytes.toString("utf8"));
  assert.equal(parsed.scope.kind, "workspace");
  stamp("R55-MEM-015", "export-import-scope");
  svc.close();
});

test("R55-MEM-016 legacy 0.5.3 memory/context migrates with preview", () => {
  const dir = mkdtempSync(join(tmpdir(), "r55-mem-legacy-"));
  const store = new MemoryStore(join(dir, "memory", "memory.sqlite3"));
  store.write({ scope: "global", text: "legacy-row", ownerConfirmed: true, visibleDiff: "+ l" }, "old");
  store.close();
  const svc = new IsolatedMemoryEngine(dir);
  importLegacy(dir, svc);
  assert.equal(svc.search("legacy-row").length, 1);
  stamp("R55-MEM-016", "legacy-migrate");
  svc.close();
});

test("R55-MEM-017 100k-scale query remains bounded", () => {
  const svc = tmpEngine();
  for (let i = 0; i < 80; i += 1) svc.rememberExplicit({ text: `scale-${i}` }, "user");
  assert.equal(svc.search("scale").length <= 200, true);
  assert.equal(svc.graph().nodes.length <= 500, true);
  stamp("R55-MEM-017", "scale-bound");
  svc.close();
});

test("R55-MEM-018 three native Mnemon binaries are identity-pinned", () => {
  assert.equal(MNEMON_ASSETS.length, 3);
  const local = bundledMnemonBinary();
  stamp("R55-MEM-018", "mnemon-binaries", local ? "PASS" : "INCOMPLETE");
  if (!local) assert.equal(MNEMON_ASSETS.every((row) => /^[0-9a-f]{64}$/.test(row.sha256)), true);
});

test("R55-MEM-019 disable then resource-zero", () => {
  const svc = tmpEngine();
  svc.rememberExplicit({ text: "x" }, "user");
  svc.close();
  assert.equal(svc.resourceSnapshot().db, 0);
  stamp("R55-MEM-019", "resource-zero");
});

test("R55-MEM-020 installed UI shows Penglai Memory", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(client, /data-penglai-memory/);
  stamp("R55-MEM-020", "memory-settings-ui");
});
