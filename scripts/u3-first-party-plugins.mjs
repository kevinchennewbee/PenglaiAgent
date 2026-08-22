import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT, gitState } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { attachPage, freePort } from "./lib/cdp.mjs";
import { observeOfficialTransport } from "./lib/browser-window-walk.mjs";
import {
  assertInstalledPenglaiIdentity,
  installFromExactInstaller,
  launchInstalledHarness,
  leftoversByCommand,
  ownedProcessTree,
  requestBrowserClose,
  resourcesInside,
  stopChild,
  waitForFile,
} from "./lib/installed-app.mjs";
import { inspectPackagedCandidate } from "./lib/packaged-candidate.mjs";
import {
  installerForTarget,
  nativeBlocked,
  parseTargetArg,
} from "./lib/release-targets.mjs";

const OPTIONAL_PLUGINS = [
  "@penglai/im",
  "@penglai/asr",
  "@penglai/moss-tts",
  "@penglai/context",
  "@penglai/memory",
  "@penglai/budget",
  "@penglai/companion",
];

const outDir = join(ROOT, "evidence/generated");
mkdirSync(outDir, { recursive: true });
const recPath = join(outDir, "u3-first-party-plugins.json");
const writeRec = (value) => writeFileSync(recPath, `${JSON.stringify(value, null, 2)}\n`);

const git = gitState();
if (git.branch !== "main" || git.head !== git.originMain || git.dirty) {
  finish("STALE", {
    command: "u3-first-party-plugins",
    reason: "candidate source must be clean main at origin/main",
    ...git,
  });
}

const target = parseTargetArg();
const blocked = nativeBlocked("u3-first-party-plugins", target);
if (blocked) finish("BLOCKED", { command: "u3-first-party-plugins", ...blocked });
const installer = installerForTarget(target);
const installedRoot = join(ROOT, ".tmp", "u3-plugin-app");
const userData = join(ROOT, ".tmp", "u3-plugin-profile");
const installed = installFromExactInstaller(
  join(ROOT, "dist", installer),
  installedRoot,
  target,
);
if (!installed.ok) {
  finish(installed.blocked ? "BLOCKED" : "INCOMPLETE", {
    command: "u3-first-party-plugins",
    reason: installed.reason ?? "exact installer missing",
    target,
  });
}
const identity = assertInstalledPenglaiIdentity(installed.app, target);
if (!identity.ok) {
  finish("FAIL", {
    command: "u3-first-party-plugins",
    reason: `installed app identity ${identity.reason}`,
  });
}
const packaged = inspectPackagedCandidate({
  app: installed.app,
  candidateSha: git.head,
  expectedTarget: target,
});
if (packaged.verdict !== "PASS") {
  finish(packaged.verdict, {
    command: "u3-first-party-plugins",
    reason: packaged.reason,
  });
}
const harness = process.env.PENGLAI_INSTALLED_UI_HARNESS;
if (!harness) {
  finish("INCOMPLETE", {
    command: "u3-first-party-plugins",
    reason: "installed plugin compatibility requires a separate Electron harness",
    target,
  });
}

const resources = resourcesInside(installed.app, target);
const profilePatch = join(userData, "dsh-home", "profiles", "web", "cordis.patch.yml");
const inventoryPath = join(userData, "plugins", "inventory-snapshot.json");
const packageRoot = join(userData, "dsh-home", "profiles", "web", "node_modules", "@penglai");
const dshNeedle = resolve(join(resources, "runtime/dsh/lib/bin.js"));
rmSync(userData, { recursive: true, force: true });
mkdirSync(userData, { recursive: true });

function pluginRows(snapshot) {
  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  return OPTIONAL_PLUGINS.map((id) => {
    const hit = entries.find((row) => row?.moduleName === id);
    return {
      id,
      present: Boolean(hit),
      enabled: hit?.enabled === true,
      phase: hit?.fiberPhase ?? null,
    };
  });
}

function rowsMatch(snapshot, enabled) {
  return pluginRows(snapshot).every(
    (row) => row.present && row.enabled === enabled && (enabled ? row.phase === "active" : row.phase === null),
  );
}

async function waitInventory(enabled, notBefore, timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    try {
      last = JSON.parse(readFileSync(inventoryPath, "utf8"));
      if (Date.parse(String(last?.at ?? "")) >= notBefore && rowsMatch(last, enabled)) return last;
    } catch (error) {
      const missing = error && typeof error === "object" && "code" in error && error.code === "ENOENT";
      if (!missing && !(error instanceof SyntaxError)) throw error;
      // The host creates and then replaces this snapshot; retry a missing or partial read.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  return last;
}

function setProfileEnabled(enabled) {
  let text = readFileSync(profilePatch, "utf8");
  for (const id of OPTIONAL_PLUGINS) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^\\s+name:\\s+["']?${escaped}["']?\\s*\\r?\\n\\s+disabled:\\s+)(true|false)`, "m");
    if (!pattern.test(text)) throw new Error(`installed profile is missing ${id}`);
    text = text.replace(pattern, `$1${enabled ? "false" : "true"}`);
  }
  writeFileSync(profilePatch, text, { mode: 0o600 });
}

function installedPackages() {
  return OPTIONAL_PLUGINS.map((id) => {
    const file = join(packageRoot, id.split("/")[1], "package.json");
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      return {
        id,
        present: value.name === id,
        version: value.version,
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { id, present: false };
      }
      throw error;
    }
  });
}

async function runPhase(name, expectedEnabled) {
  rmSync(join(userData, "gateway.port"), { force: true });
  const debugPort = await freePort();
  const startedAt = Date.now();
  const launched = launchInstalledHarness(harness, resources, userData, [
    `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*",
  ]);
  const sawGateway = await waitForFile(join(userData, "gateway.port"), 90_000);
  let official = null;
  let attachErr = "";
  let cdpSession = null;
  try {
    const { session } = await attachPage(debugPort, 90_000);
    cdpSession = session;
    official = await observeOfficialTransport(session);
  } catch (error) {
    attachErr = error instanceof Error ? error.message : String(error);
  }
  const inventory = await waitInventory(expectedEnabled, startedAt);
  const tree = ownedProcessTree(installed.app, resources, launched.child.pid);
  const gracefulBrowserClose = await requestBrowserClose(cdpSession);
  await stopChild(launched.child);
  const leftovers = leftoversByCommand(dshNeedle);
  return {
    name,
    expectedEnabled,
    sawGateway,
    gracefulBrowserClose,
    attachErr: attachErr || undefined,
    official: {
      http: official?.http?.official === true,
      websocket: official?.websocket?.opened === true,
      hasRoot: official?.snap?.hasRoot === true,
      hasDshBoot: official?.snap?.hasDshBoot === true,
    },
    rows: pluginRows(inventory),
    packages: installedPackages(),
    processTree: {
      dshPid: tree.dshPid,
      ownedAbsolute: tree.ownedAbsolute,
      leftovers: leftovers.length,
    },
    outputTail: launched.output().slice(-1200),
  };
}

let phases = [];
try {
  phases.push(await runPhase("fresh-default-disabled", false));
  setProfileEnabled(true);
  phases.push(await runPhase("all-enabled", true));
  phases.push(await runPhase("all-enabled-after-restart", true));
  setProfileEnabled(false);
  phases.push(await runPhase("all-disabled-after-restart", false));
} catch (error) {
  const rec = {
    command: "u3-first-party-plugins",
    verdict: "FAIL",
    installer,
    installerSha256: installed.installerSha256,
    sourceSha: packaged.release.sourceSha,
    target,
    reason: error instanceof Error ? error.message : String(error),
    phases,
  };
  writeRec(rec);
  finish("FAIL", rec);
}

const activePhases = phases.filter((phase) => phase.expectedEnabled);
const disabledPhases = phases.filter((phase) => !phase.expectedEnabled);
const commonOk = phases.every(
  (phase) =>
    phase.sawGateway &&
    !phase.attachErr &&
    phase.official.http &&
    phase.official.websocket &&
    phase.processTree.ownedAbsolute &&
    phase.processTree.dshPid > 0 &&
    phase.processTree.leftovers === 0,
);
const activeOk = activePhases.every(
  (phase) =>
    phase.rows.every((row) => row.present && row.enabled && row.phase === "active") &&
    phase.packages.every((pkg) => pkg.present && pkg.version === "0.5.3"),
);
const disabledOk = disabledPhases.every((phase) =>
  phase.rows.every((row) => row.present && !row.enabled && row.phase === null),
);
const ok = commonOk && activeOk && disabledOk;
const rec = {
  command: "u3-first-party-plugins",
  verdict: ok ? "PASS" : "FAIL",
  installer,
  installerSha256: installed.installerSha256,
  sourceSha: packaged.release.sourceSha,
  target,
  dsh: packaged.release.dsh,
  plugins: OPTIONAL_PLUGINS,
  method:
    "exact installed profile behind the pre-DSH wizard; official DSH HTTP/WebSocket and loader inventory; enable all; restart; disable all; restart",
  phases,
};
writeRec(rec);
if (!ok) finish("FAIL", rec);
finish("PASS", rec);
