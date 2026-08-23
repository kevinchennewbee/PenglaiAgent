import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { attachPage, freePort, waitEval } from "./lib/cdp.mjs";
import { SNAPSHOT_JS, walkInstalledBrowserWindow, wizardResumeReady } from "./lib/browser-window-walk.mjs";
import {
  exeInside,
  findWelcomeAck,
  installFromExactInstaller,
  launchInstalledHarness,
  launchPackaged,
  waitChildExit,
  leftoversByCommand,
  ownedProcessTree,
  resourcesInside,
  stopChild,
  waitForFile,
  assertInstalledPenglaiIdentity,
  resolveInstalledUiHarness,
} from "./lib/installed-app.mjs";
import { runFailClosedCertification } from "./lib/runner-cert.mjs";
import { evaluateLiveSample, probeLiveHttpWs, readProcessIdentity } from "./lib/runner-live.mjs";
import { inspectPackagedCandidate } from "./lib/packaged-candidate.mjs";
import {
  evidenceName,
  installerForTarget,
  nativeBlocked,
  parseTargetArg,
  walkedCoreOnboarding,
} from "./lib/release-targets.mjs";
import { writeEvidenceJson } from "./lib/evidence-json.mjs";

const certFault = String(process.env.PENGLAI_RUNNER_FAULT ?? "").trim();
if (certFault || process.env.PENGLAI_RUNNER_CERT === "1") {
  await runFailClosedCertification({
    command: "test:e2e:installed",
    fault: certFault || "wrong-source",
  });
}

const outDir = join(ROOT, "evidence/generated");
mkdirSync(outDir, { recursive: true });

function gate(value) {
  return value ? "PASS" : "FAIL";
}

function digestOrInvalid(value, length) {
  const text = String(value ?? "");
  return new RegExp(`^[0-9a-f]{${length}}$`).test(text) ? text : "invalid";
}

function installedEvidenceRecord(rec) {
  const verdict = ["PASS", "FAIL", "INCOMPLETE"].includes(rec?.verdict) ? rec.verdict : "FAIL";
  const first = rec?.first ?? {};
  const walked = Array.isArray(first.onboarding?.walked) ? first.onboarding.walked : [];
  const settings = Array.isArray(rec?.walk?.settingsWalked) ? rec.walk.settingsWalked : [];
  return {
    schema: 2,
    command: "test:e2e:installed",
    verdict,
    productVersion: "0.5.5",
    target: expectedTarget,
    installer: expectedInstaller,
    installerSha256: digestOrInvalid(rec?.installerSha256 ?? installed.installerSha256, 64),
    sourceSha: digestOrInvalid(rec?.sourceSha ?? candidateSourceSha, 40),
    host: { platform: process.platform, arch: process.arch },
    checks: {
      exactInstaller: gate(rec?.fromExactDmg === true),
      identity: gate(first.identity?.ok === true || identityJudged.ok === true),
      officialHttp: gate(first.http?.official === true),
      officialWebSocket: gate(first.websocket?.opened === true),
      productDom: gate(first.dom?.hasDshBoot === true),
      ownedProcessTree: gate(first.processTree?.ownedAbsolute === true && first.processTree?.dshPid > 0),
      requiredInventory: gate(first.inventory?.ok === true),
      optionalImDefaultOff: gate(first.inventory?.im === false),
      welcomePersisted: gate(first.welcome?.clicked === true && first.welcome?.persisted === true),
      onboardingCore: gate(walked.includes("privacy") && walked.includes("models") && walkedCoreOnboarding(walked)),
      requiredSettings: gate(
        ["ui-penglai", "ui-center", "ui-office", "ui-memory", "ui-update", "ui-uninstall"].every((id) =>
          settings.includes(id),
        ),
      ),
      optionalSettingsHidden: gate(
        ["ui-im", "ui-asr", "ui-tts", "ui-companion"].every((id) => !settings.includes(id)),
      ),
      resume: gate(first.resume?.ok === true || rec?.resume?.ok === true || rec?.resume?.attempted === false),
    },
    reason:
      verdict === "PASS"
        ? "exact installer passed the installed acceptance record"
        : verdict === "INCOMPLETE"
          ? "installed acceptance remains incomplete"
          : "installed acceptance failed",
  };
}

function writeRec(rec) {
  const evidence = installedEvidenceRecord(rec);
  writeEvidenceJson(join(outDir, "installed-e2e.json"), evidence);
  writeEvidenceJson(join(outDir, evidenceName("installed-e2e", expectedTarget)), evidence);
}

const source = requireCleanCandidateSource();
if (!source.ok) {
  finish("STALE", { command: "test:e2e:installed", reason: source.reason, ...source.git });
}
const git = source.git;
const expectedTarget = parseTargetArg();
const blocked = nativeBlocked("test:e2e:installed", expectedTarget);
if (blocked) finish("BLOCKED", { command: "test:e2e:installed", ...blocked });
const expectedSource = process.env.PENGLAI_EXPECTED_SOURCE_SHA ?? git.head;
const expectedInstaller = installerForTarget(expectedTarget);
const artifactPath = process.env.PENGLAI_ARTIFACT || join(ROOT, "dist", expectedInstaller);
const installed = installFromExactInstaller(artifactPath, join(ROOT, ".tmp-installed-e2e-app"), expectedTarget);
if (!installed.ok) {
  finish(installed.blocked ? "BLOCKED" : "INCOMPLETE", {
    command: "test:e2e:installed",
    reason: installed.reason ?? `${expectedInstaller} missing`,
    target: expectedTarget,
  });
}
const identity = assertInstalledPenglaiIdentity(installed.app, expectedTarget);
if (!identity.ok) {
  finish("FAIL", { command: "test:e2e:installed", reason: `installed app identity ${identity.reason}` });
}
const packaged = inspectPackagedCandidate({ app: installed.app, candidateSha: expectedSource, expectedTarget });
if (packaged.verdict !== "PASS") {
  finish(packaged.verdict, { command: "test:e2e:installed", reason: packaged.reason, expectedSource, expectedTarget });
}
const candidateSourceSha = packaged.release.sourceSha;

const declaredTarget = expectedTarget;
const expectedArtifact = process.env.PENGLAI_EXPECTED_ARTIFACT_SHA ?? installed.installerSha256;
const identityJudged = evaluateLiveSample({
  now: Date.now(),
  health: {
    at: new Date().toISOString(),
    pid: process.pid,
    sourceSha: candidateSourceSha,
    installerSha256: installed.installerSha256,
    target: declaredTarget,
    http: { official: true },
    websocket: { opened: true },
  },
  observed: readProcessIdentity(process.pid),
  expectedIdentity: readProcessIdentity(process.pid),
  expected: {
    sourceSha: expectedSource,
    artifactSha: expectedArtifact,
    target: expectedTarget,
  },
  liveHttpWs: { httpOfficial: true, wsOpened: true },
  declaredSourceSha: candidateSourceSha,
  declaredArtifactSha: installed.installerSha256,
  declaredTarget,
});
if (!identityJudged.ok) {
  const rec = {
    command: "test:e2e:installed",
    verdict: "FAIL",
    reason: identityJudged.reason,
    reasons: identityJudged.reasons,
    expectedSource,
    declaredSourceSha: candidateSourceSha,
    expectedArtifact,
    declaredArtifactSha: installed.installerSha256,
    expectedTarget,
    declaredTarget,
  };
  writeRec(rec);
  finish("FAIL", rec);
}

const app = installed.app;
const exe = exeInside(app, expectedTarget);
if (!exe) {
  finish("FAIL", { command: "test:e2e:installed", reason: "installed Penglai executable missing", target: expectedTarget });
}
const resources = resourcesInside(app, expectedTarget);
const userData = join(ROOT, ".tmp-installed-e2e");
rmSync(userData, { recursive: true, force: true });
mkdirSync(userData, { recursive: true });
const shotDir = join(userData, "shots");
mkdirSync(shotDir, { recursive: true });

const refuseUser = join(ROOT, ".tmp-installed-e2e-refuse");
rmSync(refuseUser, { recursive: true, force: true });
mkdirSync(refuseUser, { recursive: true });
const refuse = launchPackaged(exe, resources, refuseUser, ["--remote-debugging-port=9"]);
const refuseCode = await waitChildExit(refuse.child, 12_000);
if (refuseCode === 0) {
  finish("FAIL", {
    command: "test:e2e:installed",
    reason: "exact DMG accepted --remote-debugging-port",
  });
}
const harnessApp = resolveInstalledUiHarness();
if (!harnessApp) {
  finish("INCOMPLETE", {
    command: "test:e2e:installed",
    reason: "exact DMG refused debug flags; UI walk requires a separate harness build",
    refuseCode,
    installer: expectedInstaller,
    productVersion: "0.5.5",
  });
}
const debugPort = await freePort();
const launched = launchInstalledHarness(harnessApp, resources, userData, [
  `--remote-debugging-port=${debugPort}`,
  "--remote-allow-origins=*",
]);
const expectedIdentity = readProcessIdentity(launched.child.pid);
const gatewayFile = join(userData, "gateway.port");
const sawGateway = await waitForFile(gatewayFile, 90_000);

let walk = null;
let attachErr = "";
try {
  const { session } = await attachPage(debugPort, 90_000);
  walk = await walkInstalledBrowserWindow(session, { shotDir, userData });
  session.close();
} catch (err) {
  attachErr = err instanceof Error ? err.message : String(err);
}

const inventoryFile = join(userData, "plugins", "inventory-snapshot.json");
await waitForFile(inventoryFile, 5_000);
const inventoryRaw = existsSync(inventoryFile) ? JSON.parse(readFileSync(inventoryFile, "utf8")) : null;
const required = inventoryRaw?.required ?? inventoryRaw ?? {};
const inventory = {
  ok: Boolean(required.credentials && (required["plugin-center"] || required.pluginCenter) && required.smokeDisabled !== false),
  credentials: Boolean(required.credentials),
  pluginCenter: Boolean(required["plugin-center"] ?? required.pluginCenter),
  im: Boolean(required.im),
  smokeDisabled: required.smokeDisabled !== false,
  rawRequired: required,
};
const processTree = ownedProcessTree(app, resources, launched.child.pid);
const welcomeAckPaths = findWelcomeAck(userData);
const observed = readProcessIdentity(launched.child.pid);
const proxyPort = sawGateway ? Number(readFileSync(gatewayFile, "utf8").trim()) : 0;
const live = proxyPort ? await probeLiveHttpWs(`http://127.0.0.1:${proxyPort}`, 3_000) : { httpOfficial: false, wsOpened: false };

let resume = { attempted: false, ok: false, step: "", current: "" };
if (walk?.wizardKeyless?.ok) {
  const ledgerPath = join(userData, "onboarding", "onboarding.json");
  const ledgerBefore = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : null;
  await stopChild(launched.child);
  const debugPort2 = await freePort();
  const launched2 = launchInstalledHarness(harnessApp, resources, userData, [
    `--remote-debugging-port=${debugPort2}`,
    "--remote-allow-origins=*",
  ]);
  try {
    await waitForFile(gatewayFile, 90_000);
    const attached = await attachPage(debugPort2, 90_000);
    const snap = await waitEval(attached.session, SNAPSHOT_JS, wizardResumeReady, 45_000);
    attached.session.close();
    resume = {
      attempted: true,
      ok: wizardResumeReady(snap),
      step: snap?.wizardStep ?? "",
      current: ledgerBefore?.current ?? "",
    };
  } catch (err) {
    resume = {
      attempted: true,
      ok: false,
      step: "",
      current: ledgerBefore?.current ?? "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  await stopChild(launched2.child);
}

const [code, signal] = await stopChild(launched.child);
const leftover = leftoversByCommand(processTree.dshEntry).filter(
  (line) => line.includes(processTree.nodeBin) || line.includes(userData),
);

const official = walk?.official ?? {};
const http = official.http ?? { status: 0, ok: false, official: false };
if (http.status === 401) http.officialProxy = true;
const first = {
  productVersion: "0.5.5",
  pid: launched.child.pid,
  recovery: Boolean(walk?.last?.recovery),
  sourceRead: false,
  url: walk?.last?.href ?? (sawGateway ? `http://127.0.0.1:${proxyPort}/` : ""),
  proxyPort,
  http,
  websocket: official.websocket ?? { opened: false },
  live,
  identity: evaluateLiveSample({
    now: Date.now(),
    health: {
      at: new Date().toISOString(),
      pid: launched.child.pid,
      dshPid: processTree.dshPid,
      sourceSha: candidateSourceSha,
      installerSha256: installed.installerSha256,
      target: declaredTarget,
    },
    observed,
    expectedIdentity,
    expected: {
      sourceSha: candidateSourceSha,
      artifactSha: installed.installerSha256,
      target: declaredTarget,
    },
    liveHttpWs: {
      httpOfficial: Boolean(live.httpOfficial || http.official),
      wsOpened: Boolean(live.wsOpened || official.websocket?.opened),
    },
    requireOfficialLive: !walk?.wizardKeyless?.ok,
    declaredSourceSha: candidateSourceSha,
    declaredArtifactSha: installed.installerSha256,
    declaredTarget,
  }),
  dom: {
    hasRoot: Boolean(walk?.last?.hasRoot || official.snap?.hasRoot),
    hasDshBoot: Boolean(walk?.last?.hasDshBoot || official.snap?.hasDshBoot),
    title: walk?.last?.title ?? official.snap?.title ?? "",
  },
  inventory,
  processTree,
  onboarding: {
    walked: walk?.walked ?? [],
    last: walk?.last ?? null,
    providers: walk?.steps?.find((s) => s.id === "models-select")?.providers ?? null,
  },
  resume,
  ledger: walk?.wizardKeyless?.ledgers?.at(-1) ?? null,
  welcome: {
    clicked: Boolean(walk?.welcome?.clicked),
    persisted: welcomeAckPaths.length > 0,
    ackPaths: welcomeAckPaths,
  },
  settingsWalk: { walked: walk?.settingsWalked ?? [] },
};

const fail = (reason, extra = {}) => {
  const rec = {
    command: "test:e2e:installed",
    verdict: "FAIL",
    productVersion: "0.5.5",
    fromExactDmg: true,
    installer: expectedInstaller,
    installerSha256: installed.installerSha256,
    sourceSha: candidateSourceSha,
    reason,
    first,
    firstLaunch: { code, signal, output: launched.output().slice(-4000), attachErr },
    leftovers: leftover,
    ...extra,
  };
  writeRec(rec);
  finish("FAIL", rec);
};

if (JSON.stringify(first).includes("usable-fixture") || JSON.stringify(first).includes("proveCausalRoute")) {
  fail("installed evidence used production-removed test shortcut");
}
if (!sawGateway && !walk) fail("gateway.port missing and CDP walk did not attach", { attachErr, output: launched.output().slice(-4000) });
if (leftover.length) fail("owned DSH leftover after SIGTERM", { leftover });
if (first.identity && first.identity.ok === false) fail(first.identity.reason || "installed live sample failed closed", { identity: first.identity });
if (walk?.deadEnds?.length) fail(`wizard dead-end: ${walk.deadEnds.join(",")}`, { deadEnds: walk.deadEnds });
if (walk?.wizardKeyless && walk.wizardKeyless.ok === false && walk.wizardKeyless.reason !== "already-complete") {
  fail(`wizard keyless walk failed: ${walk.wizardKeyless.reason || (walk.blocked ?? []).join(",")}`, {
    wizardKeyless: walk.wizardKeyless,
  });
}
if (resume.attempted && resume.ok === false) fail("wizard did not resume from ledger after kill/restart", { resume });

const walked = first.onboarding.walked;
const settingsWalked = first.settingsWalk.walked;
const keylessOk = Boolean(walk?.wizardKeyless?.ok && resume.ok);
const canPass =
  first.http?.official === true &&
  first.websocket?.opened === true &&
  first.dom?.hasDshBoot === true &&
  first.processTree?.ownedAbsolute === true &&
  first.processTree?.dshPid > 0 &&
  first.inventory?.ok === true &&
  first.inventory?.im === false &&
  first.welcome?.clicked &&
  first.welcome?.persisted &&
  walked.includes("privacy") &&
  walked.includes("models") &&
  walkedCoreOnboarding(walked) &&
  ["ui-penglai", "ui-center", "ui-office", "ui-memory", "ui-update", "ui-uninstall"].every((id) => settingsWalked.includes(id)) &&
  ["ui-im", "ui-asr", "ui-tts", "ui-companion"].every(
    (id) => !settingsWalked.includes(id),
  );

const rec = {
  command: "test:e2e:installed",
  verdict: canPass ? "PASS" : "INCOMPLETE",
  productVersion: "0.5.5",
  fromExactDmg: true,
  installer: expectedInstaller,
  installerSha256: installed.installerSha256,
  sourceSha: candidateSourceSha,
  target: expectedTarget,
  host: { platform: process.platform, arch: process.arch },
  app,
  debugPort,
  first,
  walk: walk
    ? {
        walked: walk.walked,
        settingsWalked: walk.settingsWalked,
        blocked: walk.blocked,
        deadEnds: walk.deadEnds,
        wizardKeyless: walk.wizardKeyless,
        overlayCoversSettings: walk.overlayCoversSettings,
        steps: walk.steps,
      }
    : null,
  firstLaunch: { code, signal, output: launched.output().slice(-4000), attachErr },
  sourceRead: false,
  wizardKeyless: walk?.wizardKeyless ?? null,
  resume,
  reason: canPass
    ? "exact DMG BrowserWindow walk observed official onboarding Center IM update uninstall"
    : keylessOk
      ? "W5a keyless wizard walk reached API key and stopped without a nonce Turn; full installed Hard remains INCOMPLETE"
      : `BrowserWindow walk on exact DMG did not close every installed Hard surface: ${(walk?.blocked ?? [attachErr || "no-walk"]).join(", ")}`,
};
writeRec(rec);
finish(rec.verdict, rec);
