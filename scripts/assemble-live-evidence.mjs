import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { writeEvidenceJson } from "./lib/evidence-json.mjs";
import { evidenceName, RELEASE_TARGETS } from "./lib/release-targets.mjs";

const outDir = join(ROOT, "evidence/generated");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readRecord = (path, label) => {
  if (!existsSync(path)) finish("INCOMPLETE", { command: "assemble:live-evidence", reason: `${label} missing` });
  const bytes = readFileSync(path);
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch {
    finish("FAIL", { command: "assemble:live-evidence", reason: `${label} malformed` });
  }
};

const source = requireCleanCandidateSource();
if (!source.ok) finish("STALE", { command: "assemble:live-evidence", reason: source.reason, ...source.git });
const nativeInstallers = RELEASE_TARGETS.map((target) => {
  const record = readRecord(join(outDir, evidenceName("local-installer", target)), `${target} installer`).value;
  if (record.target !== target || record.sourceSha !== source.git.head || !/^[0-9a-f]{64}$/.test(String(record.sha256 ?? ""))) {
    finish("STALE", { command: "assemble:live-evidence", reason: `${target} installer binding is stale` });
  }
  return { target, installerSha256: record.sha256 };
});

const modelCandidates = RELEASE_TARGETS.map((target) => ({
  target,
  path: join(outDir, evidenceName("installed-e2e-live", target)),
})).filter((row) => existsSync(row.path));
if (modelCandidates.length !== 1) {
  finish("INCOMPLETE", {
    command: "assemble:live-evidence",
    reason: `expected one final official-model runner record, found ${modelCandidates.length}`,
  });
}
const modelRecord = readRecord(modelCandidates[0].path, "official model runner");
const model = modelRecord.value;
if (
  model.command !== "test:e2e:installed:live" ||
  model.verdict !== "PASS" ||
  model.productVersion !== "0.5.10" ||
  model.sourceSha !== source.git.head ||
  model.target !== modelCandidates[0].target ||
  model.installerSha256 !== nativeInstallers.find((row) => row.target === model.target)?.installerSha256
) {
  finish("STALE", { command: "assemble:live-evidence", reason: "official model runner is not bound to the candidate" });
}

const { evaluateLiveEvidence, LIVE_CHANNELS } = await import(
  pathToFileURL(join(ROOT, "packages/release-identity/src/live-evidence.ts")).href
);
const officialModel = {
  target: model.target,
  runnerClass: "owner-live-account",
  runnerVersion: model.runnerVersion,
  runId: model.runId,
  startedAt: model.startedAt,
  completedAt: model.completedAt,
  installerSha256: model.installerSha256,
  credentialNoEcho: model.credentialNoEcho,
  nonceDigest: model.nonceDigest,
  apiTestFinalDigest: model.apiTestFinalDigest,
  firstMessageDigest: model.firstMessageDigest,
  firstTurnFinalDigest: model.firstTurnFinalDigest,
  officialSessionDigest: model.officialSessionDigest,
  evidenceSha256: sha256(modelRecord.bytes),
};
const cases = LIVE_CHANNELS.map((platform) => {
  const path = join(outDir, `owner-live-${platform}.json`);
  const detail = readRecord(path, `${platform} live runner`);
  const value = detail.value;
  if (
    value.schemaVersion !== 1 ||
    value.scope !== "im-owner-live-case" ||
    value.command !== "test:e2e:im:live" ||
    value.verdict !== "PASS" ||
    value.productVersion !== "0.5.10" ||
    value.sourceSha !== source.git.head ||
    value.platform !== platform ||
    value.redacted !== true
  ) {
    finish("FAIL", { command: "assemble:live-evidence", reason: `${platform} live runner record is invalid` });
  }
  return {
    platform,
    target: value.target,
    runnerClass: value.runnerClass,
    runnerVersion: value.runnerVersion,
    runId: value.runId,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    installerSha256: value.installerSha256,
    challengeDigest: value.challengeDigest,
    connectionDigest: value.connectionDigest,
    inboundDigest: value.inboundDigest,
    workspaceSessionDigest: value.workspaceSessionDigest,
    outboundDigest: value.outboundDigest,
    restartDigest: value.restartDigest,
    logoutDigest: value.logoutDigest,
    evidenceSha256: sha256(detail.bytes),
  };
});
const liveSet = {
  schemaVersion: 3,
  scope: "release-native-live-set",
  productVersion: "0.5.10",
  sourceSha: source.git.head,
  nativeInstallers,
  officialModel,
  redacted: true,
  cases,
};
const evaluated = evaluateLiveEvidence(liveSet, "0.5.10", {
  sourceSha: source.git.head,
  nativeInstallers: Object.fromEntries(nativeInstallers.map((row) => [row.target, row.installerSha256])),
});
if (evaluated.verdict !== "PASS") {
  finish(evaluated.verdict, { command: "assemble:live-evidence", reason: evaluated.reason });
}
mkdirSync(outDir, { recursive: true });
const output = join(outDir, "live.json");
writeEvidenceJson(output, liveSet);
finish("PASS", {
  command: "assemble:live-evidence",
  output: relative(ROOT, output).replaceAll("\\", "/"),
  sourceSha: source.git.head,
  officialTarget: model.target,
  acceptedPlatforms: evaluated.acceptedPlatforms,
});
