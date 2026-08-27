import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { ROOT } from "./lib/repo.mjs";
import { EXIT_BY_VERDICT } from "./lib/exit-contract.mjs";
import { beginEvidenceRun, finishEvidenceRun, recordCommand, HOST_TARGET } from "./lib/evidence-dir.mjs";
import { MNEMON_ASSETS, hostMnemonTarget, sha256File } from "../packages/memory/src/engine/mnemon-provider.ts";

const run = beginEvidenceRun({ command: "verify:memory-real", target: HOST_TARGET });
const asset = hostMnemonTarget();
const bin = asset
  ? join(ROOT, "third_party", "mnemon", "bin", asset.target, asset.binaryFilename)
  : undefined;
if (!asset || !bin || !existsSync(bin) || sha256File(bin) !== asset.binarySha256) {
  const manifest = finishEvidenceRun(run, "INCOMPLETE", "mnemon binary missing for host target", {
    expected: MNEMON_ASSETS.map((row) => row.target),
  });
  console.error(JSON.stringify({ verdict: manifest.verdict, command: "verify:memory-real", reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.INCOMPLETE);
}

function mnemon(dataDir, args, timeoutMs = 15000, globalFlags = [], record = true, captureStdout = true) {
  const started = Date.now();
  const argv = [bin, ...globalFlags, "--data-dir", dataDir, ...args];
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { PATH: "/usr/bin:/bin", LANG: process.env.LANG ?? "C", TMPDIR: tmpdir() },
    stdio: captureStdout ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "pipe"],
  });
  if (record) {
    recordCommand(run, {
      argv,
      exitCode: result.status,
      signal: result.signal,
      durationMs: Date.now() - started,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return result;
}

const invalid = mnemon(mkdtempSync(join(tmpdir(), "mnemon-invalid-")), ["version"]);
if (invalid.status === 0) {
  const manifest = finishEvidenceRun(run, "FAIL", "invalid `mnemon version` must not succeed");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

const version = mnemon(mkdtempSync(join(tmpdir(), "mnemon-ver-")), ["--version"]);
if (version.status !== 0 || !String(version.stdout).includes("0.2.4")) {
  const manifest = finishEvidenceRun(run, "FAIL", "mnemon --version is not 0.2.4");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

const personal = mkdtempSync(join(tmpdir(), "mnemon-personal-"));
const wsA = mkdtempSync(join(tmpdir(), "mnemon-wsa-"));
const wsB = mkdtempSync(join(tmpdir(), "mnemon-wsb-"));

const remembered = mnemon(personal, ["remember", "我叫测试用户", "--cat", "fact", "--source", "user", "--tags", "identity"]);
if (remembered.status !== 0) {
  const manifest = finishEvidenceRun(run, "FAIL", "mnemon remember failed", { stderr: remembered.stderr });
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}
const added = JSON.parse(remembered.stdout);
mnemon(wsA, ["remember", "Penglai only ships 0.5.7", "--cat", "fact", "--tags", "project"]);
mnemon(wsB, ["remember", "workspace B secret fact", "--cat", "fact", "--tags", "project"]);

const found = mnemon(personal, ["search", "测试用户"]);
const recall = mnemon(personal, ["recall", "测试用户"]);
const related = mnemon(personal, ["related", added.id]);
const viz = mnemon(personal, ["viz", "--format", "dot"]);
if (found.status !== 0 || !found.stdout.includes("测试用户")) {
  const manifest = finishEvidenceRun(run, "FAIL", "mnemon search missed explicit remember");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}
if (recall.status !== 0 || !recall.stdout.includes(added.id)) {
  const manifest = finishEvidenceRun(run, "FAIL", "mnemon recall missed id");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}
if (related.status !== 0) {
  const manifest = finishEvidenceRun(run, "FAIL", "mnemon related failed");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}
if (viz.status !== 0 || !viz.stdout.includes("digraph")) {
  const manifest = finishEvidenceRun(run, "FAIL", "mnemon viz did not emit DOT");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

const leak = mnemon(wsB, ["search", "Penglai only ships"]);
if (leak.stdout.includes("Penglai only ships")) {
  const manifest = finishEvidenceRun(run, "FAIL", "workspace B searched workspace A content");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

mnemon(personal, ["forget", added.id]);
const afterForget = mnemon(personal, ["search", "测试用户"]);
if (afterForget.stdout.includes(added.id) || afterForget.stdout.includes("我叫测试用户")) {
  const manifest = finishEvidenceRun(run, "FAIL", "forget did not remove recall");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

const restartDir = personal;
const again = mnemon(restartDir, ["status"]);
if (again.status !== 0) {
  const manifest = finishEvidenceRun(run, "FAIL", "status after restart failed");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

const ro = mnemon(wsA, ["remember", "should fail"], 15000, ["--readonly"]);
const mnemonReadonlyHonored = ro.status !== 0;

const load100kDir = mkdtempSync(join(tmpdir(), "mnemon-100k-"));
const load100kStarted = Date.now();
const seed = mnemon(load100kDir, ["remember", "scale100k-000000", "--cat", "fact", "--tags", "load,r55"]);
if (seed.status !== 0) {
  const failed = finishEvidenceRun(run, "FAIL", "Mnemon could not seed the 100k query fixture", { stderr: seed.stderr });
  console.error(JSON.stringify({ verdict: failed.verdict, reason: failed.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}
const seedStatus = mnemon(load100kDir, ["status"]);
let dbPath = "";
try {
  dbPath = String(JSON.parse(String(seedStatus.stdout)).db_path ?? "");
} catch {
  dbPath = "";
}
if (!dbPath || !existsSync(dbPath)) {
  const failed = finishEvidenceRun(run, "FAIL", "Mnemon did not expose its initialized database path");
  console.error(JSON.stringify({ verdict: failed.verdict, reason: failed.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

// R55-MEM-017 is a query-scale gate, not an import-throughput claim. Mnemon
// creates/migrates the schema above; this deterministic fixture builder then
// inserts inactive benchmark facts directly into that exact schema. All query
// assertions below execute through the unmodified, hash-pinned Mnemon binary.
const fixtureStarted = Date.now();
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; BEGIN IMMEDIATE;");
const insert = db.prepare(
  `INSERT INTO insights(id, content, category, importance, tags, entities, source, access_count, created_at, updated_at, deleted_at, effective_importance)
   VALUES (?, ?, 'fact', 3, '[\"load\",\"r55\"]', '[]', 'benchmark-fixture', 0, ?, ?, NULL, 0.5)`,
);
const createdAt = "2026-08-23T00:00:00.000Z";
try {
  for (let i = 1; i < 100_000; i += 1) {
    const serial = String(i).padStart(6, "0");
    const idTail = String(i).padStart(12, "0");
    insert.run(`00000000-0000-4000-8000-${idTail}`, `scale100k-${serial}`, createdAt, createdAt);
  }
  db.exec("COMMIT;");
} catch (error) {
  db.exec("ROLLBACK;");
  db.close();
  const failed = finishEvidenceRun(run, "FAIL", "100k Mnemon query fixture construction failed", {
    detail: error instanceof Error ? error.message : "fixture error",
  });
  console.error(JSON.stringify({ verdict: failed.verdict, reason: failed.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}
db.close();
const fixtureDurationMs = Date.now() - fixtureStarted;

const status100k = mnemon(load100kDir, ["status"]);
let totalInsights = 0;
try {
  totalInsights = Number(JSON.parse(String(status100k.stdout)).total_insights ?? 0);
} catch {
  totalInsights = 0;
}
if (status100k.status !== 0 || totalInsights !== 100_000) {
  const failed = finishEvidenceRun(run, "FAIL", "Mnemon status did not prove an exact 100k corpus", {
    fixtureRows: 100_000,
    totalInsights,
  });
  console.error(JSON.stringify({ verdict: failed.verdict, reason: failed.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

const queryTimes = [];
for (const marker of ["scale100k-000000", "scale100k-050000", "scale100k-099999"]) {
  const started = Date.now();
  const foundScale = mnemon(load100kDir, ["search", marker], 30_000);
  queryTimes.push(Date.now() - started);
  if (foundScale.status !== 0 || !String(foundScale.stdout).includes(marker)) {
    const failed = finishEvidenceRun(run, "FAIL", `Mnemon 100k search missed ${marker}`);
    console.error(JSON.stringify({ verdict: failed.verdict, reason: failed.reason }));
    process.exit(EXIT_BY_VERDICT.FAIL);
  }
}
queryTimes.sort((a, b) => a - b);
const load100k = {
  n: totalInsights,
  target: 100_000,
  timedOut: false,
  fixture: "official-schema-seed-plus-deterministic-sqlite-query-fixture",
  fixtureDurationMs,
  queryP95Ms: queryTimes[Math.floor(queryTimes.length * 0.95)] ?? 0,
  durationMs: Date.now() - load100kStarted,
  rss: process.memoryUsage().rss,
};
recordCommand(run, {
  argv: [process.execPath, "node:sqlite", "build-exact-100k-query-fixture"],
  exitCode: 0,
  durationMs: load100k.durationMs,
  stdout: JSON.stringify(load100k),
});

writeFileSync(join(run.dir, "artifacts", "personal-viz.dot"), viz.stdout ?? "");
const manifest = finishEvidenceRun(run, "PASS", "real Mnemon operations, isolation, and exact 100k corpus query", {
  mnemonVersion: String(version.stdout).trim(),
  binary: bin,
  mnemonReadonlyHonored,
  load100k,
  note: mnemonReadonlyHonored
    ? "mnemon --readonly blocked writes"
    : "upstream --readonly did not block writes on a writable volume; Penglai runner must refuse write commands itself",
});
rmSync(wsA, { recursive: true, force: true });
rmSync(wsB, { recursive: true, force: true });
rmSync(load100kDir, { recursive: true, force: true });
console.log(JSON.stringify({ verdict: manifest.verdict, command: "verify:memory-real", sourceSha: manifest.sourceSha, dir: run.dir }));
process.exit(EXIT_BY_VERDICT[manifest.verdict] ?? 1);
