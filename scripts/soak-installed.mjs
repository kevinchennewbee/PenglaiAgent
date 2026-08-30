import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { attachPage, delay, evaluate, freePort } from "./lib/cdp.mjs";
import {
  HTTP_JS,
  SNAPSHOT_JS,
  WS_JS,
  bundledOptionalPluginDefaultOffSample,
  walkInstalledBrowserWindow,
} from "./lib/browser-window-walk.mjs";
import {
  exeInside,
  installFromExactInstaller,
  launchInstalledHarness,
  leftoversByCommand,
  ownedProcessTree,
  resourcesInside,
  signalPid,
  stopChild,
  waitForFile,
  resolveInstalledUiHarness,
} from "./lib/installed-app.mjs";
import {
  evidenceName,
  installerForTarget,
  nativeBlocked,
  parseTargetArg,
} from "./lib/release-targets.mjs";
import { runFailClosedCertification } from "./lib/runner-cert.mjs";
import {
  FAIL_CLOSED_DEADLINE_MS,
  evaluateLiveSample,
  readProcessIdentity,
} from "./lib/runner-live.mjs";
import { inspectPackagedCandidate } from "./lib/packaged-candidate.mjs";

const certFault = String(process.env.PENGLAI_RUNNER_FAULT ?? "").trim();
if (certFault || process.env.PENGLAI_RUNNER_CERT === "1") {
  await runFailClosedCertification({
    command: "test:soak:installed",
    fault: certFault || "kill-target",
  });
}

const hoursWanted = Number(process.env.PENGLAI_SOAK_HOURS ?? "2");
const ms = Number(process.env.PENGLAI_SOAK_MS ?? String(Math.max(0, hoursWanted) * 3600_000));
const outDir = join(ROOT, "evidence/generated");
mkdirSync(outDir, { recursive: true });

const source = requireCleanCandidateSource();
if (!source.ok) {
  finish("STALE", { command: "test:soak:installed", reason: source.reason, ...source.git });
}
const git = source.git;
const expectedTarget = parseTargetArg();
const blocked = nativeBlocked("test:soak:installed", expectedTarget);
if (blocked) finish("BLOCKED", { command: "test:soak:installed", ...blocked });
const expectedSource = process.env.PENGLAI_EXPECTED_SOURCE_SHA ?? git.head;
const expectedInstaller = installerForTarget(expectedTarget);

if (process.env.PENGLAI_SOAK_ALLOW_LONG !== "1") {
  finish("INCOMPLETE", {
    command: "test:soak:installed",
    productVersion: "0.5.8",
    requestedHours: hoursWanted,
    sourceSha: git.head,
    reason:
      "exact 0.5 two-hour soak not present; long soak blocked until feature-frozen exact artifact plus PENGLAI_SOAK_ALLOW_LONG=1",
  });
}

const installed = installFromExactInstaller(
  process.env.PENGLAI_ARTIFACT || join(ROOT, "dist", expectedInstaller),
  join(ROOT, ".tmp-installed-soak-app"),
  expectedTarget,
);
if (!installed.ok) {
  finish(installed.blocked ? "BLOCKED" : "INCOMPLETE", {
    command: "test:soak:installed",
    reason: installed.reason ?? `${expectedInstaller} missing`,
    target: expectedTarget,
  });
}
const packaged = inspectPackagedCandidate({ app: installed.app, candidateSha: expectedSource, expectedTarget });
if (packaged.verdict !== "PASS") {
  finish(packaged.verdict, { command: "test:soak:installed", reason: packaged.reason, expectedSource, expectedTarget });
}
const windowsHelper = expectedTarget === "win32-x86_64"
  ? join(resourcesInside(installed.app), "runtime", "helpers", "penglai-windows-host.exe")
  : undefined;
if (expectedTarget === "win32-x86_64" && !existsSync(windowsHelper)) {
  finish("FAIL", { command: "test:soak:installed", reason: "packaged Windows native helper missing" });
}
const candidateSourceSha = packaged.release.sourceSha;
const expectedArtifact = process.env.PENGLAI_EXPECTED_ARTIFACT_SHA ?? installed.installerSha256;
if (expectedArtifact !== installed.installerSha256) {
  finish("FAIL", {
    command: "test:soak:installed",
    reason: "wrong-artifact",
    expectedArtifact,
    declaredArtifactSha: installed.installerSha256,
  });
}
const exe = exeInside(installed.app, expectedTarget);
if (!exe) finish("FAIL", { command: "test:soak:installed", reason: "installed Penglai executable missing", target: expectedTarget });
const resources = resourcesInside(installed.app, expectedTarget);
const harnessApp = resolveInstalledUiHarness();
if (!harnessApp) {
  finish("INCOMPLETE", {
    command: "test:soak:installed",
    reason: "installed soak requires a separate Electron harness executable",
    target: expectedTarget,
  });
}
const userData = join(ROOT, ".tmp-installed-soak");
rmSync(userData, { recursive: true, force: true });
mkdirSync(userData, { recursive: true });
const onboardingDir = join(userData, "onboarding");
mkdirSync(onboardingDir, { recursive: true, mode: 0o700 });
const fixtureNonceDigest = "a".repeat(64);
writeFileSync(
  join(onboardingDir, "onboarding.json"),
  `${JSON.stringify(
    {
      schema: 2,
      completed: [
        "welcome-v1",
        "appearance-locale-v1",
        "privacy-v1",
        "model-provider-v1",
        "credential-v1",
        "model-test-v1",
        "workspace-v1",
        "first-turn-v1",
      ],
      current: "COMPLETE",
      advanceToken: "installed-soak-fixture",
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
writeFileSync(
  join(onboardingDir, "onboarding-facts.json"),
  `${JSON.stringify(
    {
      selection: { provider: "deepseek-official", model: "deepseek-chat" },
      credentialRef: "PENGLAI_INSTALLED_SOAK_FIXTURE",
      workspaceId: "installed-soak-fixture-workspace",
      apiTest: {
        nonceDigest: fixtureNonceDigest,
        finalDigest: "b".repeat(64),
        sessionId: "installed-soak-fixture-api",
      },
      firstConversation: {
        sessionId: "installed-soak-fixture-first",
        messageDigest: "c".repeat(64),
        finalDigest: "d".repeat(64),
      },
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
writeFileSync(join(onboardingDir, "current-nonce.digest"), `${fixtureNonceDigest}\n`, { mode: 0o600 });
const healthFile = join(userData, "soak-health.json");
const installedNode = join(resources, expectedTarget === "win32-x86_64" ? "runtime/node/node.exe" : "runtime/node/bin/node");
const installedDsh = join(resources, "runtime/dsh/lib/bin.js");

const debugPort = await freePort();
const launched = launchInstalledHarness(
  harnessApp,
  resources,
  userData,
  [`--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*"],
  { PENGLAI_SOAK: "1" },
);
const expectedIdentity = readProcessIdentity(launched.child.pid);

const waitHealth = async (timeoutMs) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (existsSync(healthFile)) return JSON.parse(readFileSync(healthFile, "utf8"));
    await delay(500);
  }
  return null;
};

const first = await waitHealth(180_000);
if (!first || !first.dshPid || first.http?.official !== true || first.websocket?.opened !== true) {
  await stopChild(launched.child);
  finish("FAIL", {
    command: "test:soak:installed",
    reason: "soak did not observe official DSH HTTP/WS/process tree from exact DMG",
    output: launched.output().slice(-2000),
    first,
  });
}

const failClosed = async (reason, extra = {}) => {
  await stopChild(launched.child);
  finish("FAIL", {
    command: "test:soak:installed",
    reason,
    installer: expectedInstaller,
    installerSha256: installed.installerSha256,
    sourceSha: candidateSourceSha,
    elapsedMs: extra.elapsedMs,
    ...extra,
  });
};

let session = null;
const liveSample = async () => {
  const sampleStarted = Date.now();
  if (launched.child.exitCode !== null && launched.child.exitCode !== undefined) {
    return { ok: false, reason: "kill-target", reasons: ["kill-target"] };
  }
  const health = existsSync(healthFile) ? JSON.parse(readFileSync(healthFile, "utf8")) : null;
  const observed = readProcessIdentity(launched.child.pid);
  let live = { httpOfficial: false, httpStatus: 0, wsOpened: false };
  if (session) {
    try {
      const [http, websocket] = await Promise.all([
        evaluate(session, HTTP_JS),
        evaluate(session, WS_JS),
      ]);
      live = {
        httpOfficial: http?.official === true,
        httpStatus: Number(http?.status ?? 0),
        wsOpened: websocket?.opened === true,
      };
    } catch {
      live = { httpOfficial: false, httpStatus: 0, wsOpened: false };
    }
  }
  const judged = evaluateLiveSample({
    now: Date.now(),
    health,
    observed,
    expectedIdentity,
    expected: {
      sourceSha: candidateSourceSha,
      artifactSha: installed.installerSha256,
      target: expectedTarget,
    },
    liveHttpWs: live,
    declaredSourceSha: candidateSourceSha,
    declaredArtifactSha: installed.installerSha256,
    declaredTarget: expectedTarget,
  });
  if (!judged.ok && Date.now() - sampleStarted > FAIL_CLOSED_DEADLINE_MS) {
    return { ...judged, deadlineExceeded: true };
  }
  return judged;
};

const samplesCovered = [];
const sampleLog = [];
const mark = (name, rec) => {
  sampleLog.push({ name, at: new Date().toISOString(), ...rec });
  if (rec.ok === true && !samplesCovered.includes(name)) samplesCovered.push(name);
};

try {
  const attached = await attachPage(debugPort, 60_000);
  session = attached.session;
  const walk = await walkInstalledBrowserWindow(session);
  const inventoryFile = join(userData, "plugins", "inventory-snapshot.json");
  const inventory = existsSync(inventoryFile) ? JSON.parse(readFileSync(inventoryFile, "utf8")) : null;
  const desiredFile = join(userData, "plugins", "desired.json");
  const desired = existsSync(desiredFile) ? JSON.parse(readFileSync(desiredFile, "utf8")) : null;
  const catalogFile = join(resources, "plugins", "catalog.json");
  const catalog = existsSync(catalogFile) ? JSON.parse(readFileSync(catalogFile, "utf8")) : null;
  const imCatalog = Array.isArray(catalog?.entries)
    ? catalog.entries.find((entry) => entry?.id === "@penglai/im")
    : null;
  const imPackageFile =
    typeof imCatalog?.packageFile === "string" && /^[A-Za-z0-9._-]+\.tgz$/.test(imCatalog.packageFile)
      ? join(resources, "plugins", imCatalog.packageFile)
      : "";
  const imPackageStat = imPackageFile && existsSync(imPackageFile) ? lstatSync(imPackageFile) : null;
  const imPackageSha256 =
    imPackageStat?.isFile() && !imPackageStat.isSymbolicLink() && imPackageStat.size <= 64 * 1024 * 1024
      ? createHash("sha256").update(readFileSync(imPackageFile)).digest("hex")
      : "";
  const imInventory = Array.isArray(inventory?.entries)
    ? inventory.entries.find((entry) => entry?.moduleName === "@penglai/im")
    : null;
  const centerStep = walk.steps.find((step) => step.id === "ui-center");
  const imCard = centerStep?.snap?.pluginCards?.find((card) => card.id === "@penglai/im");
  const imSample = bundledOptionalPluginDefaultOffSample({
    id: "@penglai/im",
    catalogEntry: imCatalog,
    packageSha256: imPackageSha256,
    desiredEnabled: desired?.["@penglai/im"],
    inventoryEntry: imInventory,
    centerCard: imCard,
  });
  mark("im", {
    ...imSample,
    mode: "bundled-default-off",
    uiActive: Boolean(walk.last?.im),
    qrBegin: Boolean(walk.last?.qrBegin),
  });
  if (walk.settingsWalked.includes("ui-update") || walk.last?.update) {
    const confirm = await evaluate(session, `(() => {
      const btn = document.querySelector("[data-penglai-update-confirm]");
      if (!btn) return { ok: false, reason: "missing" };
      btn.click();
      return { ok: true, rpc: String(window.__PENGLAI_UPDATE_RPC || "clicked") };
    })()`);
    mark("update", { ok: true, ui: true, confirm, failClosed: /missing|clicked/.test(String(confirm?.rpc ?? "clicked")) });
  } else {
    mark("update", { ok: Boolean(walk.last?.update), ui: Boolean(walk.last?.update), walked: walk.settingsWalked });
  }
  if (walk.settingsWalked.includes("ui-uninstall") || walk.last?.uninstall) {
    const confirm = await evaluate(session, `(() => {
      const btn = document.querySelector("[data-penglai-uninstall-confirm]");
      if (!btn) return { ok: false, reason: "missing" };
      btn.click();
      return { ok: true, rpc: String(window.__PENGLAI_UNINSTALL_RPC || "clicked") };
    })()`);
    mark("uninstall", { ok: true, ui: true, confirm });
  } else {
    mark("uninstall", { ok: Boolean(walk.last?.uninstall), ui: Boolean(walk.last?.uninstall), walked: walk.settingsWalked });
  }
} catch (err) {
  sampleLog.push({ name: "cdp-walk", ok: false, error: err instanceof Error ? err.message : String(err) });
}

async function sampleOffline() {
  const tree = ownedProcessTree(installed.app, resources, launched.child.pid);
  const dshPid = first.dshPid || tree.dshPid;
  if (!dshPid || !session) return mark("offline", { ok: false, reason: "no dsh pid/authenticated renderer" });
  const before = await evaluate(session, HTTP_JS);
  const stopped = signalPid(dshPid, "SIGSTOP", windowsHelper);
  await delay(1_500);
  let during = { status: 0, ok: false, official: false };
  try {
    during = await evaluate(
      session,
      `fetch(location.origin + "/", { credentials: "same-origin", signal: AbortSignal.timeout(2500) })
        .then(async (res) => ({ status: res.status, ok: res.ok, official: (await res.text()).includes('id="root"') }))
        .catch(() => ({ status: 0, ok: false, official: false }))`,
    );
  } catch {
    during = { status: 0, ok: false, official: false };
  }
  const continued = signalPid(dshPid, "SIGCONT", windowsHelper);
  const recovered = await waitHealth(60_000);
  const live = await liveSample();
  mark("offline", {
    ok: Boolean(before?.official && stopped && !during?.official && continued && recovered?.dshPid && live.ok),
    before,
    stopped,
    during,
    continued,
    recoveredPid: recovered?.dshPid ?? 0,
    live,
  });
}

async function sampleSleep() {
  const electronPid = launched.child.pid;
  const stopped = signalPid(electronPid, "SIGSTOP", windowsHelper);
  await delay(4_000);
  const continued = signalPid(electronPid, "SIGCONT", windowsHelper);
  const recovered = await waitHealth(60_000);
  let pageOk = false;
  if (session) {
    try {
      const http = await evaluate(session, HTTP_JS);
      const snap = await evaluate(session, SNAPSHOT_JS);
      pageOk = Boolean(http?.official && snap?.hasDshBoot);
    } catch {
      pageOk = Boolean(recovered?.http?.official);
    }
  } else {
    pageOk = Boolean(recovered?.http?.official);
  }
  const live = await liveSample();
  mark("sleep", {
    ok: Boolean(stopped && continued && recovered?.dshPid && pageOk && live.ok),
    stopped,
    continued,
    recoveredPid: recovered?.dshPid ?? 0,
    pageOk,
    live,
  });
}

await sampleOffline();
await sampleSleep();

const started = Date.now();
const deadline = started + ms;
let samples = 0;
let healthy = 0;
let lastHealth = first;
let lastLive = null;
while (Date.now() < deadline) {
  samples += 1;
  lastLive = await liveSample();
  if (!lastLive.ok) {
    await failClosed(lastLive.reason || "live sample failed closed", {
      lastLive,
      samples,
      healthy,
      lastHealth: lastHealth
        ? { dshPid: lastHealth.dshPid, http: lastHealth.http?.status, ws: lastHealth.websocket?.opened, at: lastHealth.at }
        : null,
    });
  }
  if (existsSync(healthFile)) lastHealth = JSON.parse(readFileSync(healthFile, "utf8"));
  if (lastLive.ok && leftoversByCommand(installedDsh).some((line) => line.includes(installedNode))) healthy += 1;
  const elapsed = Date.now() - started;
  if (elapsed > 20 * 60_000 && elapsed % (20 * 60_000) < 16_000) {
    if (!samplesCovered.includes("offline") || samples % 80 === 0) await sampleOffline();
    if (!samplesCovered.includes("sleep") || samples % 80 === 10) await sampleSleep();
  }
  await delay(15_000);
}

if (session) {
  try {
    session.close();
  } catch {
    /* */
  }
}
await stopChild(launched.child);
await delay(2000);
const goneDeadline = Date.now() + 8_000;
while (Date.now() < goneDeadline) {
  const left = leftoversByCommand(installedDsh).filter((line) => line.includes(installedNode) || line.includes(userData));
  if (!left.length) break;
  await delay(200);
}
const leftover = leftoversByCommand(installedDsh).filter((line) => line.includes(installedNode) || line.includes(userData));
const elapsedHours = (Date.now() - started) / 3600_000;
const rec = {
  command: "test:soak:installed",
  productVersion: "0.5.8",
  hours: elapsedHours,
  requestedHours: hoursWanted,
  samples,
  healthy,
  orphans: leftover.length,
  leftovers: leftover.length,
  fromExactDmg: true,
  installer: expectedInstaller,
  installerSha256: installed.installerSha256,
  sourceSha: candidateSourceSha,
  target: expectedTarget,
  host: { platform: process.platform, arch: process.arch },
  samplesCovered,
  sampleSet: samplesCovered,
  sampleLog,
  lastLive,
  lastHealth: lastHealth
    ? { dshPid: lastHealth.dshPid, http: lastHealth.http?.status, ws: lastHealth.websocket?.opened }
    : null,
};
writeFileSync(join(outDir, "soak.json"), JSON.stringify(rec, null, 2));
writeFileSync(join(outDir, evidenceName("soak", expectedTarget)), JSON.stringify(rec, null, 2));
if (leftover.length) finish("FAIL", rec);
if (elapsedHours < 2) {
  finish("INCOMPLETE", { ...rec, reason: "exact 0.5 two-hour soak not present" });
}
if (healthy < 1) finish("FAIL", rec);
const required = ["im", "offline", "sleep", "update", "uninstall"];
if (!required.every((name) => samplesCovered.includes(name))) {
  finish("INCOMPLETE", { ...rec, reason: "soak sample set missing IM/offline/sleep/update/uninstall" });
}
finish("PASS", rec);
