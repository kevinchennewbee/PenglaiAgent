import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, readJson } from "./lib/repo.mjs";
import { finish, parseReportFlag } from "./lib/exit-contract.mjs";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const injectIdx = argv.indexOf("--inject-fail");
const injectFail = injectIdx >= 0 ? argv[injectIdx + 1] : null;

const { HARD_SUBGATES, evaluateApplicableDomain, evaluateReleaseAggregation, releaseVerdictFrom, resolveSubgateVerdict, SUBGATE_JSON_FILES } = await import(
  pathToFileURL(join(ROOT, "packages/release-identity/src/index.ts")).href
);

function readGateJson(name) {
  const rel = SUBGATE_JSON_FILES[name];
  if (!rel) return null;
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function runGate(name) {
  if (injectFail === name) return { name, exit: 1, verdict: "FAIL", jsonVerdict: null };
  if (dryRun) {
    const json = readGateJson(name);
    const gate = HARD_SUBGATES.find((g) => g.name === name);
    if (!json && gate?.mode === "evidence") {
      return { name, exit: 2, verdict: "INCOMPLETE", jsonVerdict: null };
    }
    const resolved = resolveSubgateVerdict({
      processExit: 0,
      processVerdict: "PASS",
      json,
    });
    return { name, exit: resolved.exit, verdict: resolved.verdict, jsonVerdict: json?.verdict ?? null };
  }
  const r = spawnSync("pnpm", ["run", name], { cwd: ROOT, encoding: "utf8" });
  const processExit = r.status ?? 1;
  let processVerdict = "FAIL";
  if (processExit === 0) processVerdict = "PASS";
  else if (processExit === 2) processVerdict = "INCOMPLETE";
  else if (processExit === 3) processVerdict = "STALE";
  else if (processExit === 4) processVerdict = "BLOCKED";
  const json = readGateJson(name);
  const resolved = resolveSubgateVerdict({
    processExit,
    processVerdict,
    json,
  });
  if (resolved.exit !== 0) {
    process.stderr.write(r.stdout || "");
    process.stderr.write(r.stderr || "");
  }
  return { name, exit: resolved.exit, verdict: resolved.verdict, jsonVerdict: json?.verdict ?? null };
}

const records = [];
for (const gate of HARD_SUBGATES) {
  records.push(runGate(gate.name));
}

const info = readJson("release-info.json");
const summaryPath = join(ROOT, "evidence/generated/evidence-summary.json");
const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : null;

let notaryEvidence = "absent";
const notaryPath = join(ROOT, "dist/notarization-summary.json");
if (existsSync(notaryPath)) {
  const raw = JSON.parse(readFileSync(notaryPath, "utf8"));
  if (raw.fake === true || raw.dryRun === true) notaryEvidence = "fake";
  else if (raw.status === "Waived" || raw.verdict === "WAIVED") notaryEvidence = "claimed-waived";
  else if (raw.status === "Accepted") notaryEvidence = "accepted";
  else if (raw.verdict === "PASS") notaryEvidence = "claimed-pass";
}

const agg = evaluateReleaseAggregation({
  candidateKind: info.candidateKind,
  records,
  notaryEvidence,
  summaryVerdict: summary?.verdict,
});
const applicable = evaluateApplicableDomain({
  records,
  summaryVerdict: summary?.verdict,
  summaryTotals: summary?.totals,
});
// The arm64 automated domain is an informational subset signal: it can pass
// while deferred gates (installed/live/soak/export, which need native runners)
// remain INCOMPLETE. It must never mask those incomplete gates into a
// release-level PASS. The release verdict always starts from the full
// aggregation; the domain can only escalate it to FAIL, never to PASS.
const release = releaseVerdictFrom(applicable, agg);

const out = {
  command: "verify:release",
  verdict: release.verdict,
  overallVerdict: agg.verdict,
  exitCode: release.exitCode,
  candidateKind: info.candidateKind,
  listedKinds: agg.listedKinds,
  missingGates: agg.missingGates,
  failReasons: agg.failReasons,
  applicableDomain: applicable,
  notarized: false,
  authenticode: false,
  notaryStatus: agg.notaryStatus,
  notaryRecordedAs: agg.notaryRecordedAs,
  records,
  totals: summary?.totals ?? null,
  dryRun,
  injectFail,
};
mkdirSync(join(ROOT, "evidence/generated"), { recursive: true });
writeFileSync(join(ROOT, "evidence/generated/verify-release.json"), JSON.stringify(out, null, 2));
if (parseReportFlag() || dryRun) {
  console.log(JSON.stringify(out));
  if (dryRun) process.exit(out.exitCode);
}
finish(out.verdict, out);
