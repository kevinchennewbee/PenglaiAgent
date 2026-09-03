import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { evidenceName, RELEASE_TARGETS } from "./lib/release-targets.mjs";

const liveSetPath = join(ROOT, "evidence/generated/live.json");
if (!existsSync(liveSetPath)) {
  finish("INCOMPLETE", { command: "verify:live", reason: "no owner live-account evidence" });
}
let rec;
try {
  rec = JSON.parse(readFileSync(liveSetPath, "utf8"));
} catch (error) {
  finish("FAIL", { command: "verify:live", reason: `invalid live evidence JSON: ${String(error)}` });
}
const { evaluateLiveEvidence, LIVE_CHANNELS } = await import(
  pathToFileURL(join(ROOT, "packages/release-identity/src/live-evidence.ts")).href
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readEvidence = (file, label) => {
  if (!existsSync(file)) finish("INCOMPLETE", { command: "verify:live", reason: `${label} runner evidence missing` });
  const bytes = readFileSync(file);
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch {
    finish("FAIL", { command: "verify:live", reason: `${label} runner evidence malformed` });
  }
};
const source = requireCleanCandidateSource();
if (!source.ok) {
  finish("STALE", { command: "verify:live", reason: source.reason, ...source.git });
}
const nativeInstallers = {};
for (const target of RELEASE_TARGETS) {
  const installerEvidence = join(ROOT, "evidence/generated", evidenceName("local-installer", target));
  if (!existsSync(installerEvidence)) {
    finish("INCOMPLETE", { command: "verify:live", reason: `missing native installer evidence for ${target}` });
  }
  const installer = JSON.parse(readFileSync(installerEvidence, "utf8"));
  if (
    installer.target !== target ||
    installer.sourceSha !== source.git.head ||
    !/^[0-9a-f]{64}$/.test(String(installer.sha256 ?? ""))
  ) {
    finish("STALE", { command: "verify:live", reason: `native installer evidence is stale for ${target}` });
  }
  nativeInstallers[target] = installer.sha256;
}
const result = evaluateLiveEvidence(rec, "0.5.10", {
  sourceSha: source.git.head,
  nativeInstallers,
});
if (result.verdict !== "PASS") {
  finish(result.verdict, { command: "verify:live", reason: result.reason, acceptedPlatforms: result.acceptedPlatforms });
}

const officialSummary = rec.officialModel;
const officialPath = join(
  ROOT,
  "evidence/generated",
  evidenceName("installed-e2e-live", officialSummary.target),
);
const official = readEvidence(officialPath, "official model");
if (sha256(official.bytes) !== officialSummary.evidenceSha256) {
  finish("FAIL", { command: "verify:live", reason: "official model evidence digest mismatch" });
}
const officialFields = {
  runnerVersion: official.value.runnerVersion,
  runId: official.value.runId,
  startedAt: official.value.startedAt,
  completedAt: official.value.completedAt,
  target: official.value.target,
  installerSha256: official.value.installerSha256,
  credentialNoEcho: official.value.credentialNoEcho,
  nonceDigest: official.value.nonceDigest,
  apiTestFinalDigest: official.value.apiTestFinalDigest,
  firstMessageDigest: official.value.firstMessageDigest,
  firstTurnFinalDigest: official.value.firstTurnFinalDigest,
  officialSessionDigest: official.value.officialSessionDigest,
};
const expectedOfficialFields = { ...officialSummary };
delete expectedOfficialFields.runnerClass;
delete expectedOfficialFields.evidenceSha256;
if (
  official.value.command !== "test:e2e:installed:live" ||
  official.value.verdict !== "PASS" ||
  official.value.productVersion !== "0.5.10" ||
  official.value.sourceSha !== source.git.head ||
  official.value.officialNonceTurn !== true ||
  official.value.officialFirstTurn !== true ||
  official.value.onboardingComplete !== true ||
  official.value.processOwned !== true ||
  official.value.nativeExecutableBoot !== true ||
  Object.entries(expectedOfficialFields).some(([key, value]) => officialFields[key] !== value)
) {
  finish("FAIL", { command: "verify:live", reason: "official model summary is not the exact installed runner record" });
}

for (const platform of LIVE_CHANNELS) {
  const summary = rec.cases.find((entry) => entry.platform === platform);
  const detailPath = join(ROOT, "evidence/generated", `owner-live-${platform}.json`);
  const detail = readEvidence(detailPath, `${platform} live`);
  if (sha256(detail.bytes) !== summary.evidenceSha256) {
    finish("FAIL", { command: "verify:live", reason: `${platform} runner evidence digest mismatch` });
  }
  const summaryFields = { ...summary };
  delete summaryFields.evidenceSha256;
  const detailFields = Object.fromEntries(Object.keys(summaryFields).map((key) => [key, detail.value[key]]));
  if (
    detail.value.schemaVersion !== 1 ||
    detail.value.scope !== "im-owner-live-case" ||
    detail.value.command !== "test:e2e:im:live" ||
    detail.value.verdict !== "PASS" ||
    detail.value.productVersion !== "0.5.10" ||
    detail.value.sourceSha !== source.git.head ||
    detail.value.redacted !== true ||
    Object.entries(summaryFields).some(([key, value]) => detailFields[key] !== value)
  ) {
    finish("FAIL", { command: "verify:live", reason: `${platform} summary is not the exact IM runner record` });
  }
}
finish(result.verdict, { command: "verify:live", reason: result.reason, acceptedPlatforms: result.acceptedPlatforms });
