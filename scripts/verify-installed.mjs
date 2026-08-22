import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, gitState } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { inspectInstallerEvidence, inspectPackagedCandidate, packagedAppForTarget } from "./lib/packaged-candidate.mjs";
import {
  evidenceName,
  hostMatchesTarget,
  installerForTarget,
  missingReleaseTargets,
  nativeBlocked,
  parseTargetArg,
  RELEASE_TARGETS,
  walkedCoreOnboarding,
} from "./lib/release-targets.mjs";

const identity = await import(pathToFileURL(join(ROOT, "packages/release-identity/src/index.ts")).href);

const evidenceDir = join(ROOT, "evidence/generated");
const assertionFile = join(evidenceDir, "installed-assertions.jsonl");
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(assertionFile, "");
process.env.PENGLAI_EVIDENCE_DIR = assertionFile;

if (process.argv.includes("--aggregate")) {
  const present = RELEASE_TARGETS.filter((target) => existsSync(join(evidenceDir, evidenceName("installed-e2e", target))));
  const missing = missingReleaseTargets(present);
  const sourceShas = present.map((target) => {
    const rec = JSON.parse(readFileSync(join(evidenceDir, evidenceName("installed-e2e", target)), "utf8"));
    return rec.sourceSha;
  });
  const unique = [...new Set(sourceShas.filter(Boolean))];
  if (missing.length) {
    finish("INCOMPLETE", {
      command: "verify:installed",
      reason: "three-target installed evidence set is incomplete",
      present,
      missing,
    });
  }
  if (unique.length !== 1) {
    finish("FAIL", {
      command: "verify:installed",
      reason: "installed evidence source SHA is not identical across targets",
      unique,
    });
  }
  finish("PASS", { command: "verify:installed", targets: present, sourceSha: unique[0] });
}

const target = parseTargetArg();
const blocked = nativeBlocked("verify:installed", target);
if (blocked) finish("BLOCKED", { command: "verify:installed", ...blocked });

const path = existsSync(join(evidenceDir, evidenceName("installed-e2e", target)))
  ? join(evidenceDir, evidenceName("installed-e2e", target))
  : target === "darwin-aarch64"
    ? join(evidenceDir, "installed-e2e.json")
    : join(evidenceDir, evidenceName("installed-e2e", target));
if (!existsSync(path)) {
  finish("INCOMPLETE", { command: "verify:installed", reason: `no 0.5.3 installed evidence for ${target}`, target });
}
const rec = JSON.parse(readFileSync(path, "utf8"));
const blob = JSON.stringify(rec);
if (/0\.2\.0-alpha|usable-fixture|sourceRead":true|Penglai-v0\.2\.0/.test(blob)) {
  finish("STALE", { command: "verify:installed", reason: "installed evidence is stale alpha or test-endpoint based" });
}
if (rec.productVersion !== "0.5.3" || rec.verdict !== "PASS") {
  finish("INCOMPLETE", { command: "verify:installed", reason: "0.5 installed suite not PASS", target });
}
const expectedInstaller = installerForTarget(target);
if (rec.fromExactDmg !== true || rec.installer !== expectedInstaller) {
  finish("FAIL", {
    command: "verify:installed",
    reason: `installed evidence was not from exact ${expectedInstaller}`,
    target,
  });
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
const dmgPath = join(evidenceDir, evidenceName("local-installer", target));
const legacyDmg = join(evidenceDir, "local-dmg.json");
const evidencePath = existsSync(dmgPath) ? dmgPath : legacyDmg;
const app = packagedAppForTarget(ROOT, target);
const packaged = inspectPackagedCandidate({ app, candidateSha: git.head, expectedTarget: target });
if (packaged.verdict !== "PASS") {
  finish(packaged.verdict, { command: "verify:installed", reason: packaged.reason, app, target });
}
const dmg = inspectInstallerEvidence({ root: ROOT, packaged, evidencePath });
if (dmg.verdict !== "PASS") {
  finish(dmg.verdict, { command: "verify:installed", reason: dmg.reason, dmg: dmg.installerPath ?? dmg.dmgPath, target });
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
const native = hostMatchesTarget(target);
const common = {
  candidateSourceSha: packaged.release.sourceSha,
  target,
  runnerNative: native,
  artifactSha256: rec.installerSha256,
  rawEvidencePointer: path.replace(`${ROOT}/`, ""),
  exitCode: 0,
  status: "PASS",
};
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-E2E-001",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "from-exact-installer",
  details: { safe: `installed evidence mounted exact ${expectedInstaller}` },
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
  acceptanceId: target === "win32-x86_64" ? "R50-WIN-009" : "R50-MAC-009",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "exact-installer-installed-suite",
  details: { safe: `${target} exact installer suite recorded official boot observations` },
});
if (target === "darwin-x86_64") {
  identity.recordAssertion({
    ...common,
    acceptanceId: "R50-MAC-010",
    runnerId: "installed",
    testId: "verify-installed",
    assertionId: "intel-native-runner",
    details: { safe: "Intel installer evidence was recorded on a native darwin-x86_64 runner" },
  });
}
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
if (!walkedCoreOnboarding(walked)) {
  finish("FAIL", { command: "verify:installed", reason: "workspace and first-turn steps were not walked after models" });
}
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-ONB-008",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "workspace-after-nonce",
  details: { safe: "installed walk recorded official workspace after models nonce Turn" },
});
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
  assertionId: "workspace-and-first-turn",
  details: { safe: "installed walk reached workspace and first-turn after core-ready facts" },
});
finish("PASS", { command: "verify:installed", installerSha256: rec.installerSha256, target });
