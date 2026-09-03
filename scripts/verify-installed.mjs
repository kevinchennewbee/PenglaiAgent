import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
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
} from "./lib/release-targets.mjs";

const identity = await import(pathToFileURL(join(ROOT, "packages/release-identity/src/index.ts")).href);

const evidenceDir = join(ROOT, "evidence/generated");
const assertionFile = join(evidenceDir, "installed-assertions.jsonl");
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(assertionFile, "");
process.env.PENGLAI_EVIDENCE_DIR = assertionFile;

function readTargetEvidence(base, target) {
  const path = join(evidenceDir, evidenceName(base, target));
  if (!existsSync(path)) {
    finish("INCOMPLETE", { command: "verify:installed", reason: `${base} evidence missing for ${target}`, target });
  }
  try {
    return { path, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    finish("FAIL", { command: "verify:installed", reason: `${base} evidence is malformed for ${target}`, target });
  }
}

function validateInstalledCompanions(target, installed) {
  const expectedInstaller = installerForTarget(target);
  const welcome = readTargetEvidence("u3-welcome-smoke", target);
  const plugins = readTargetEvidence("u3-first-party-plugins", target);
  for (const [label, record] of [["welcome", welcome.value], ["plugins", plugins.value]]) {
    if (
      record.verdict !== "PASS" ||
      record.target !== target ||
      record.sourceSha !== installed.sourceSha ||
      record.installer !== expectedInstaller ||
      record.installerSha256 !== installed.installerSha256
    ) {
      finish("STALE", { command: "verify:installed", reason: `${label} evidence is not bound to the installed candidate`, target });
    }
  }
  if (
    welcome.value.official?.http?.official !== true ||
    welcome.value.official?.websocket?.opened !== true ||
    welcome.value.welcome?.reachable !== true ||
    welcome.value.nextStep?.privacy !== true ||
    welcome.value.processTree?.ownedAbsolute !== true ||
    !(welcome.value.processTree?.dshPid > 0) ||
    welcome.value.processTree?.leftovers !== 0
  ) {
    finish("FAIL", { command: "verify:installed", reason: "installed welcome evidence lacks official HTTP/WS, privacy, or owned-process proof", target });
  }
  const phases = Array.isArray(plugins.value.phases) ? plugins.value.phases : [];
  const phaseOk = phases.length >= 3 && phases.every((phase) =>
    phase.official?.http === true &&
    phase.official?.websocket === true &&
    phase.official?.mounted === true &&
    phase.processTree?.ownedAbsolute === true &&
    phase.processTree?.dshPid > 0 &&
    phase.processTree?.leftovers === 0
  );
  const required = Array.isArray(plugins.value.requiredBuiltin) ? plugins.value.requiredBuiltin : [];
  const initial = phases[0];
  const enabled = phases.find((phase) => phase.name === "all-enabled-after-restart");
  if (
    !phaseOk ||
    !["@penglai/office", "@penglai/memory"].every((id) => required.includes(id)) ||
    initial?.requiredCapabilities?.settingsBlocked?.length !== 0 ||
    enabled?.enabledCapabilities?.optionalSettingsReady !== true ||
    enabled?.enabledCapabilities?.settingsBlocked?.length !== 0
  ) {
    finish("FAIL", { command: "verify:installed", reason: "installed plugin/settings evidence is incomplete", target });
  }
  return { welcome, plugins };
}

if (process.argv.includes("--aggregate")) {
  const present = RELEASE_TARGETS.filter((target) => existsSync(join(evidenceDir, evidenceName("installed-e2e", target))));
  const missing = missingReleaseTargets(present);
  if (missing.length) {
    finish("INCOMPLETE", {
      command: "verify:installed",
      reason: "three-target installed evidence set is incomplete",
      present,
      missing,
    });
  }
  const records = present.map((target) => {
    const rec = JSON.parse(readFileSync(join(evidenceDir, evidenceName("installed-e2e", target)), "utf8"));
    const expectedInstaller = installerForTarget(target);
    const hostMatches = target === "darwin-aarch64"
      ? rec.host?.platform === "darwin" && rec.host?.arch === "arm64"
      : target === "darwin-x86_64"
        ? rec.host?.platform === "darwin" && rec.host?.arch === "x64"
        : rec.host?.platform === "win32" && rec.host?.arch === "x64";
    if (
      rec.schema !== 2 ||
      rec.command !== "test:e2e:installed" ||
      rec.verdict !== "PASS" ||
      rec.productVersion !== "0.5.10" ||
      rec.target !== target ||
      rec.installer !== expectedInstaller ||
      !/^[0-9a-f]{64}$/.test(String(rec.installerSha256 ?? "")) ||
      !/^[0-9a-f]{40}$/.test(String(rec.sourceSha ?? "")) ||
      !hostMatches ||
      Object.values(rec.checks ?? {}).some((value) => value !== "PASS")
    ) {
      finish("FAIL", { command: "verify:installed", reason: `invalid native installed evidence for ${target}`, target });
    }
    validateInstalledCompanions(target, rec);
    return rec;
  });
  const unique = [...new Set(records.map((record) => record.sourceSha))];
  const source = requireCleanCandidateSource();
  if (!source.ok || unique.length !== 1 || unique[0] !== source.git.head) {
    finish("STALE", {
      command: "verify:installed",
      reason: "installed evidence is not bound to the exact clean source SHA",
      unique,
    });
  }
  finish("PASS", {
    command: "verify:installed",
    sourceSha: unique[0],
    targets: records.map((record) => ({ target: record.target, installerSha256: record.installerSha256 })),
  });
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
  finish("INCOMPLETE", { command: "verify:installed", reason: `no 0.5.10 installed evidence for ${target}`, target });
}
const rec = JSON.parse(readFileSync(path, "utf8"));
const blob = JSON.stringify(rec);
if (/0\.2\.0-alpha|usable-fixture|sourceRead":true|Penglai-v0\.2\.0/.test(blob)) {
  finish("STALE", { command: "verify:installed", reason: "installed evidence is stale alpha or test-endpoint based" });
}
if (rec.productVersion !== "0.5.10" || rec.verdict !== "PASS") {
  finish("INCOMPLETE", { command: "verify:installed", reason: "0.5 installed suite not PASS", target });
}
if (rec.schema !== 2 || rec.command !== "test:e2e:installed" || Object.values(rec.checks ?? {}).some((value) => value !== "PASS")) {
  finish("FAIL", { command: "verify:installed", reason: "installed keyless boundary checks are incomplete", target });
}
const expectedInstaller = installerForTarget(target);
if (rec.fromExactDmg !== true || rec.installer !== expectedInstaller) {
  finish("FAIL", {
    command: "verify:installed",
    reason: `installed evidence was not from exact ${expectedInstaller}`,
    target,
  });
}
validateInstalledCompanions(target, rec);
const source = requireCleanCandidateSource();
if (!source.ok) {
  finish("STALE", { command: "verify:installed", reason: source.reason, ...source.git });
}
const git = source.git;
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
  assertionId: "keyless-and-product-http-ws-process-inventory",
  details: { safe: "credential-free onboarding plus companion product HTTP WS owned process and loader evidence passed" },
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
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-ONB-003",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "official-llm-providers-in-models-step",
  details: { safe: "credential-free installed wizard listed the official provider catalog and reached the API key boundary" },
});
identity.recordAssertion({
  ...common,
  acceptanceId: "R50-E2E-003",
  runnerId: "installed",
  testId: "verify-installed",
  assertionId: "settings-required-builtins-optional-off-update-uninstall",
  details: { safe: "target-bound companion evidence showed required and optional plugin settings across real installed restarts" },
});
finish("PASS", {
  command: "verify:installed",
  sourceSha: source.git.head,
  installerSha256: rec.installerSha256,
  target,
  companionEvidence: [
    `evidence/generated/${evidenceName("u3-welcome-smoke", target)}`,
    `evidence/generated/${evidenceName("u3-first-party-plugins", target)}`,
  ],
});
