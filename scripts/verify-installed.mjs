import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, gitState } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { inspectDmgEvidence, inspectPackagedCandidate, packagedAppForTarget } from "./lib/packaged-candidate.mjs";

const identity = await import(pathToFileURL(join(ROOT, "packages/release-identity/src/index.ts")).href);

const evidenceDir = join(ROOT, "evidence/generated");
const assertionFile = join(evidenceDir, "installed-assertions.jsonl");
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(assertionFile, "");
process.env.PENGLAI_EVIDENCE_DIR = assertionFile;

const path = join(evidenceDir, "installed-e2e.json");
if (!existsSync(path)) {
  finish("INCOMPLETE", { command: "verify:installed", reason: "no 0.5 installed evidence" });
}
const rec = JSON.parse(readFileSync(path, "utf8"));
const blob = JSON.stringify(rec);
if (/0\.2\.0-alpha|usable-fixture|sourceRead":true|Penglai-v0\.2\.0/.test(blob)) {
  finish("STALE", { command: "verify:installed", reason: "installed evidence is stale alpha or test-endpoint based" });
}
if (rec.productVersion !== "0.5.0" || rec.verdict !== "PASS") {
  finish("INCOMPLETE", { command: "verify:installed", reason: "0.5 installed suite not PASS" });
}
if (rec.fromExactDmg !== true || rec.installer !== "Penglai_0.5.0_macos_aarch64.dmg") {
  finish("FAIL", { command: "verify:installed", reason: "installed evidence was not from exact 0.5 arm64 DMG" });
}
if (rec.sourceRead === true) {
  finish("FAIL", { command: "verify:installed", reason: "source-read cannot produce installed PASS" });
}
const first = rec.first ?? {};
if (first.http?.official !== true || first.websocket?.opened !== true || first.dom?.hasDshBoot !== true) {
  finish("FAIL", { command: "verify:installed", reason: "missing official DOM/HTTP/WS observations" });
}
if (first.processTree?.ownedAbsolute !== true || !first.processTree?.dshPid) {
  finish("FAIL", { command: "verify:installed", reason: "missing owned process tree" });
}
if (first.inventory?.ok !== true || first.inventory?.im !== false) {
  finish("FAIL", { command: "verify:installed", reason: "fresh loader inventory did not prove optional IM absent" });
}
if (!first.welcome?.clicked || !first.welcome?.persisted) {
  finish("FAIL", { command: "verify:installed", reason: "official welcome was not clicked and persisted" });
}
if (!Array.isArray(first.onboarding?.walked) || !first.onboarding.walked.includes("privacy")) {
  finish("FAIL", { command: "verify:installed", reason: "official settings.onboarding privacy step was not observed" });
}
const git = gitState();
if (git.branch !== "main" || git.head !== git.originMain || git.dirty) {
  finish("STALE", { command: "verify:installed", reason: "candidate source must be clean main at origin/main", ...git });
}
const dmgPath = join(ROOT, "evidence/generated/local-dmg.json");
const app = packagedAppForTarget(ROOT, "darwin-aarch64");
const packaged = inspectPackagedCandidate({ app, candidateSha: git.head, expectedTarget: "darwin-aarch64" });
if (packaged.verdict !== "PASS") {
  finish(packaged.verdict, { command: "verify:installed", reason: packaged.reason, app });
}
const dmg = inspectDmgEvidence({ root: ROOT, packaged, evidencePath: dmgPath });
if (dmg.verdict !== "PASS") {
  finish(dmg.verdict, { command: "verify:installed", reason: dmg.reason, dmg: dmg.dmgPath });
}
const bound = identity.bindArtifactFreshness({
  candidateSha: packaged.release.sourceSha,
  evidenceSourceSha: rec.sourceSha,
  evidenceArtifactSha256: rec.installerSha256,
  currentArtifactSha256: dmg.actualSha256,
});
if (!bound.ok) {
  finish(bound.verdict, { command: "verify:installed", reason: bound.reason });
}
const native = process.arch === "arm64" && process.platform === "darwin";
const common = {
  candidateSourceSha: packaged.release.sourceSha,
  target: "darwin-aarch64",
  runnerNative: native,
  artifactSha256: rec.installerSha256,
  rawEvidencePointer: "evidence/generated/installed-e2e.json",
  exitCode: 0,
  status: "PASS",
};
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-E2E-001",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "from-exact-arm64-dmg",
  details: { safe: "installed evidence mounted exact Penglai_0.5.0_macos_aarch64.dmg" },
});
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-E2E-002",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "official-dom-http-ws-process-inventory",
  details: { safe: "official DOM HTTP WS owned process tree and loader inventory observed" },
});
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-E2E-004",
  runnerId: "anti-cheat",
  testId: "verify-installed",
  assertionId: "rejected-source-read-and-removed-endpoints",
  details: { safe: "source-read usable-fixture and proveCausalRoute cannot produce installed PASS" },
});
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-DIST-008",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "owned-dsh-process-tree",
  details: { safe: "Electron main owned absolute embedded DSH pid observed" },
});
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-MAC-009",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "exact-dmg-installed-suite",
  details: { safe: "arm64 exact DMG installed suite recorded official boot observations" },
});
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-ONB-002",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "privacy-step-after-welcome",
  details: { safe: "installed BrowserWindow walked official settings.onboarding privacy after welcome persist" },
});
const walked = first.onboarding?.walked ?? [];
if (Number(first.onboarding?.last?.providers?.rows ?? 0) < 1 || !walked.includes("models")) {
  finish("FAIL", { command: "verify:installed", reason: "official models catalog or continue was not observed" });
}
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-ONB-003",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "official-llm-providers-in-models-step",
  details: { safe: "models step listed official llm.providers cards and continue was clicked" },
});
if (!walked.includes("workspace")) {
  finish("FAIL", { command: "verify:installed", reason: "workspace step was not walked after models" });
}
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-ONB-008",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "workspace-after-nonce",
  details: { safe: "installed walk recorded official workspace after models nonce Turn" },
});
if (!walked.includes("im-later") && !walked.includes("im-offer") && !walked.includes("mounted-im-offer")) {
  finish("FAIL", { command: "verify:installed", reason: "IM offer after CORE_READY was not observed" });
}
const settingsWalked = first.settingsWalk?.walked ?? [];
if (!["ui-penglai", "ui-center", "ui-update", "ui-uninstall"].every((id) => settingsWalked.includes(id))) {
  finish("FAIL", { command: "verify:installed", reason: "Penglai section, Center, update, or uninstall was not observed" });
}
if (["ui-im", "ui-asr", "ui-tts", "ui-context", "ui-memory", "ui-budget", "ui-companion"].some((id) => settingsWalked.includes(id))) {
  finish("FAIL", { command: "verify:installed", reason: "fresh BrowserWindow exposed an optional plugin settings page" });
}
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-E2E-003",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "settings-center-optional-off-update-uninstall",
  details: { safe: "fresh BrowserWindow showed Center update uninstall while optional plugin pages stayed absent" },
});
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-ONB-006",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "models-nonce-turn-walked",
  details: { safe: "installed walk left models after official nonce Turn path" },
});
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-ONB-009",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "core-ready-then-im-offer",
  details: { safe: "installed walk reached IM offer only after core-ready" },
});
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-ONB-010",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "im-offer-later-choice",
  details: { safe: "installed walk observed IM offer later choice after core ready" },
});
finish("PASS", { command: "verify:installed", installerSha256: rec.installerSha256 });
