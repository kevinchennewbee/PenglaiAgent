import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { EXIT_BY_VERDICT } from "./lib/exit-contract.mjs";
import { beginEvidenceRun, finishEvidenceRun, HOST_TARGET } from "./lib/evidence-dir.mjs";

const run = beginEvidenceRun({ command: "verify:community-candidates", target: HOST_TARGET });
const ledger = readFileSync(join(ROOT, "docs/0.5.5/COMMUNITY_REVIEW_LEDGER.md"), "utf8");
const auditsDir = join(ROOT, "docs/0.5.5/community-audits");
const auditFiles = existsSync(auditsDir)
  ? readdirSync(auditsDir).filter((name) => name.endsWith(".md"))
  : [];

const requiredFields = [
  "repo:",
  "commit:",
  "license:",
  "permissions:",
  "dshExact:",
  "install:",
  "verdict:",
];
const completeAudits = [];
const incompleteAudits = [];
for (const file of auditFiles) {
  const body = readFileSync(join(auditsDir, file), "utf8");
  const missing = requiredFields.filter((field) => !body.includes(field));
  if (missing.length) incompleteAudits.push({ file, missing });
  else completeAudits.push(file);
}

const approved = auditFiles.filter((file) =>
  readFileSync(join(auditsDir, file), "utf8").includes("verdict: APPROVED"),
).length;

if (/curl\s*\|\s*bash/.test(ledger)) {
  const manifest = finishEvidenceRun(run, "FAIL", "ledger contains curl|bash");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

const auditComplete = auditFiles.length >= 4 && incompleteAudits.length === 0;
const verdict = auditComplete ? "PASS" : "INCOMPLETE";
const reason = auditComplete
  ? `candidate audits complete; approvedCount=${approved}`
  : `candidate audits incomplete files=${auditFiles.length} missingFields=${JSON.stringify(incompleteAudits)}`;
const manifest = finishEvidenceRun(run, verdict, reason, {
  approvedCount: approved,
  auditCount: auditFiles.length,
  auditComplete,
});
const line = JSON.stringify({
  verdict: manifest.verdict,
  command: "verify:community-candidates",
  approvedCount: approved,
  auditComplete,
  reason: manifest.reason,
  dir: run.dir,
});
if (verdict === "PASS") console.log(line);
else console.error(line);
process.exit(EXIT_BY_VERDICT[manifest.verdict] ?? 1);
