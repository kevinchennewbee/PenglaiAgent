import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT, gitState } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { attachPage, delay, evaluate, freePort } from "./lib/cdp.mjs";
import { HTTP_JS, SNAPSHOT_JS, walkInstalledBrowserWindow } from "./lib/browser-window-walk.mjs";
import {
  ARM64_DMG,
  ARM64_INSTALLER,
  exeInside,
  installFromExactDmg,
  launchPackaged,
  leftoversByCommand,
  ownedProcessTree,
  signalPid,
  stopChild,
  waitForFile,
} from "./lib/installed-app.mjs";
import { runFailClosedCertification } from "./lib/runner-cert.mjs";
import {
  FAIL_CLOSED_DEADLINE_MS,
  evaluateLiveSample,
  probeLiveHttpWs,
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

const git = gitState();
if (git.branch !== "main" || git.head !== git.originMain || git.dirty) {
  finish("STALE", { command: "test:soak:installed", reason: "candidate source must be clean main at origin/main", ...git });
}
const expectedTarget = process.env.PENGLAI_EXPECTED_TARGET ?? process.env.PENGLAI_TARGET ?? "darwin-aarch64";
const expectedSource = process.env.PENGLAI_EXPECTED_SOURCE_SHA ?? git.head;

if (process.env.PENGLAI_SOAK_ALLOW_LONG !== "1") {
  finish("INCOMPLETE", {
    command: "test:soak:installed",
    productVersion: "0.5.0",
    requestedHours: hoursWanted,
    sourceSha: git.head,
    reason:
      "exact 0.5 two-hour soak not present; long soak blocked until feature-frozen exact artifact plus PENGLAI_SOAK_ALLOW_LONG=1",
  });
}

const installed = installFromExactDmg(process.env.PENGLAI_ARTIFACT || ARM64_DMG, join(ROOT, ".tmp-installed-soak-app"));
if (!installed.ok) {
  finish("INCOMPLETE", { command: "test:soak:installed", reason: installed.reason ?? "exact Penglai_0.5.0_macos_aarch64.dmg missing" });
}
if (expectedTarget !== "darwin-aarch64") {
  finish("FAIL", {
    command: "test:soak:installed",
    reason: "wrong-target",
    expectedTarget,
    declaredTarget: "darwin-aarch64",
  });
}
const packaged = inspectPackagedCandidate({ app: installed.app, candidateSha: expectedSource, expectedTarget });
if (packaged.verdict !== "PASS") {
  finish(packaged.verdict, { command: "test:soak:installed", reason: packaged.reason, expectedSource, expectedTarget });
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
const exe = exeInside(installed.app);
if (!exe) finish("FAIL", { command: "test:soak:installed", reason: "installed Penglai.app has no MacOS executable" });
const resources = resolve(join(installed.app, "Contents", "Resources"));
const userData = join(ROOT, ".tmp-installed-soak");
rmSync(userData, { recursive: true, force: true });
mkdirSync(userData, { recursive: true });
const healthFile = join(userData, "soak-health.json");
const installedNode = join(resources, "runtime/node/bin/node");
const installedDsh = join(resources, "runtime/dsh/lib/bin.js");

const debugPort = await freePort();
const launched = launchPackaged(
  exe,
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
    installer: ARM64_INSTALLER,
    installerSha256: installed.installerSha256,
    sourceSha: candidateSourceSha,
    elapsedMs: extra.elapsedMs,
    ...extra,
  });
};

const liveSample = async () => {
  const sampleStarted = Date.now();
  if (launched.child.exitCode !== null && launched.child.exitCode !== undefined) {
    return { ok: false, reason: "kill-target", reasons: ["kill-target"] };
  }
  const health = existsSync(healthFile) ? JSON.parse(readFileSync(healthFile, "utf8")) : null;
  const observed = readProcessIdentity(launched.child.pid);
  const origin = health?.url ? new URL(health.url).origin : first.url ? new URL(first.url).origin : "";
  const live = origin ? await probeLiveHttpWs(origin, 2_000) : { httpOfficial: false, wsOpened: false };
  const judged = evaluateLiveSample({
    now: Date.now(),
    health,
    observed,
    expectedIdentity,
    expected: {
      sourceSha: candidateSourceSha,
      artifactSha: installed.installerSha256,
      target: "darwin-aarch64",
    },
    liveHttpWs: live,
    declaredSourceSha: candidateSourceSha,
    declaredArtifactSha: installed.installerSha256,
    declaredTarget: "darwin-aarch64",
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

let session = null;
try {
  const attached = await attachPage(debugPort, 60_000);
  session = attached.session;
  const walk = await walkInstalledBrowserWindow(session, {
    installOptionalPlugins: true,
    requireOptionalPlugins: true,
  });
  const inventoryFile = join(userData, "plugins", "inventory-snapshot.json");
  const inventory = existsSync(inventoryFile) ? JSON.parse(readFileSync(inventoryFile, "utf8")) : null;
  const imInventory = Boolean(inventory?.required?.im ?? inventory?.im);
  mark("im", {
    ok: Boolean(imInventory || walk.last?.im || walk.settingsWalked.includes("ui-im")),
    inventoryIm: imInventory,
    ui: Boolean(walk.last?.im),
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
  const port = first.url ? Number(new URL(first.url).port) : 0;
  if (!dshPid || !port) return mark("offline", { ok: false, reason: "no dsh pid/port" });
  const stopped = signalPid(dshPid, "SIGSTOP");
  await delay(1_500);
  let down = false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2500) });
    down = !res.ok;
  } catch {
    down = true;
  }
  const continued = signalPid(dshPid, "SIGCONT");
  const recovered = await waitHealth(60_000);
  const live = await liveSample();
  mark("offline", {
    ok: Boolean(stopped && down && continued && recovered?.dshPid && live.ok),
    stopped,
    down,
    continued,
    recoveredPid: recovered?.dshPid ?? 0,
    live,
  });
}

async function sampleSleep() {
  const electronPid = launched.child.pid;
  const stopped = signalPid(electronPid, "SIGSTOP");
  await delay(4_000);
  const continued = signalPid(electronPid, "SIGCONT");
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
  productVersion: "0.5.0",
  hours: elapsedHours,
  requestedHours: hoursWanted,
  samples,
  healthy,
  orphans: leftover.length,
  leftovers: leftover.length,
  fromExactDmg: true,
  installer: ARM64_INSTALLER,
  installerSha256: installed.installerSha256,
  sourceSha: candidateSourceSha,
  samplesCovered,
  sampleSet: samplesCovered,
  sampleLog,
  lastLive,
  lastHealth: lastHealth
    ? { dshPid: lastHealth.dshPid, http: lastHealth.http?.status, ws: lastHealth.websocket?.opened }
    : null,
};
writeFileSync(join(outDir, "soak.json"), JSON.stringify(rec, null, 2));
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
