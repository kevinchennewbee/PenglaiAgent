import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, readJson } from "./lib/repo.mjs";

const info = readJson("release-info.json");
const kind = info.candidateKind ?? "local-acceptance";
const summary = join(ROOT, "dist/notarization-summary.json");

if (info.notarized === true && !existsSync(summary)) {
  console.error("identity claims notarized=true without evidence");
  process.exit(1);
}

if (!existsSync(summary)) {
  if (kind === "public-release" || kind === "canonical-release") {
    console.error(JSON.stringify({
      command: "verify:notarization",
      verdict: "FAIL",
      reason: `${kind} requires notarization Accepted`,
    }));
    process.exit(1);
  }
  console.log(JSON.stringify({
    command: "verify:notarization",
    candidateKind: kind,
    notarized: false,
    status: "NOT_RUN",
    attribute: true,
    verdict: "NOT_RUN",
    note: "local-acceptance does not require notarization; absence is not PASS or Waived",
  }));
  process.exit(0);
}

const raw = JSON.parse(readFileSync(summary, "utf8"));
if (raw.fake === true || raw.dryRun === true || raw.status === "Waived" || raw.verdict === "WAIVED") {
  console.error("fake/dry-run/Waived notary cannot count");
  process.exit(1);
}
if (raw.status !== "Accepted") {
  console.error("notarization not Accepted", raw.status);
  process.exit(1);
}
console.log(JSON.stringify({ command: "verify:notarization", verdict: "PASS", submissionId: raw.submissionId }));
