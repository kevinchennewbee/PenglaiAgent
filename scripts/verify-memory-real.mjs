import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";
import { EXIT_BY_VERDICT } from "./lib/exit-contract.mjs";
import { beginEvidenceRun, finishEvidenceRun, recordCommand, HOST_TARGET } from "./lib/evidence-dir.mjs";
import { bundledMnemonBinary, MNEMON_ASSETS } from "../packages/memory/src/engine/mnemon-provider.ts";

const run = beginEvidenceRun({ command: "verify:memory-real", target: HOST_TARGET });
const bin = bundledMnemonBinary()?.path;
if (!bin || !existsSync(bin)) {
  const manifest = finishEvidenceRun(run, "INCOMPLETE", "mnemon binary missing for host target", {
    expected: MNEMON_ASSETS.map((row) => row.target),
  });
  console.error(JSON.stringify({ verdict: manifest.verdict, command: "verify:memory-real", reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.INCOMPLETE);
}

function mnemon(dataDir, args, timeoutMs = 15000, globalFlags = []) {
  const started = Date.now();
  const argv = [bin, ...globalFlags, "--data-dir", dataDir, ...args];
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { PATH: "/usr/bin:/bin", LANG: process.env.LANG ?? "C", TMPDIR: tmpdir() },
  });
  recordCommand(run, {
    argv,
    exitCode: result.status,
    signal: result.signal,
    durationMs: Date.now() - started,
    stdout: result.stdout,
    stderr: result.stderr,
  });
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

const remembered = mnemon(personal, ["remember", "我叫陈克文", "--cat", "fact", "--source", "user", "--tags", "identity"]);
if (remembered.status !== 0) {
  const manifest = finishEvidenceRun(run, "FAIL", "mnemon remember failed", { stderr: remembered.stderr });
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}
const added = JSON.parse(remembered.stdout);
mnemon(wsA, ["remember", "Penglai only ships 0.5.5", "--cat", "fact", "--tags", "project"]);
mnemon(wsB, ["remember", "workspace B secret fact", "--cat", "fact", "--tags", "project"]);

const found = mnemon(personal, ["search", "陈克文"]);
const recall = mnemon(personal, ["recall", "陈克文"]);
const related = mnemon(personal, ["related", added.id]);
const viz = mnemon(personal, ["viz", "--format", "dot"]);
if (found.status !== 0 || !found.stdout.includes("陈克文")) {
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
const afterForget = mnemon(personal, ["search", "陈克文"]);
if (afterForget.stdout.includes(added.id) || afterForget.stdout.includes("我叫陈克文")) {
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

writeFileSync(join(run.dir, "artifacts", "personal-viz.dot"), viz.stdout ?? "");
const manifest = finishEvidenceRun(run, "PASS", "real mnemon remember/search/recall/related/viz/forget/isolation", {
  mnemonVersion: String(version.stdout).trim(),
  binary: bin,
  mnemonReadonlyHonored,
  note: mnemonReadonlyHonored
    ? "mnemon --readonly blocked writes"
    : "upstream --readonly did not block writes on a writable volume; Penglai runner must refuse write commands itself",
});
rmSync(wsA, { recursive: true, force: true });
rmSync(wsB, { recursive: true, force: true });
console.log(JSON.stringify({ verdict: manifest.verdict, command: "verify:memory-real", sourceSha: manifest.sourceSha, dir: run.dir }));
process.exit(EXIT_BY_VERDICT[manifest.verdict] ?? 1);
