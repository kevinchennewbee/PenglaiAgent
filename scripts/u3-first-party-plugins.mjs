import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { attachPage, freePort } from "./lib/cdp.mjs";
import {
  observeOfficialSurfaces,
  walkInstalledBrowserWindow,
} from "./lib/browser-window-walk.mjs";
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
  resolveInstalledUiHarness,
} from "./lib/installed-app.mjs";
import { inspectPackagedCandidate } from "./lib/packaged-candidate.mjs";
import { writeEvidenceJson } from "./lib/evidence-json.mjs";
import {
  evidenceName,
  installerForTarget,
  nativeBlocked,
  parseTargetArg,
} from "./lib/release-targets.mjs";

const REQUIRED_BUILTIN = ["@penglai/office", "@penglai/memory"];
const OPTIONAL_PLUGINS = [
  "@penglai/im",
  "@penglai/asr",
  "@penglai/moss-tts",
  "@penglai/budget",
  "@penglai/companion",
];
const TRACKED_PLUGINS = [...REQUIRED_BUILTIN, ...OPTIONAL_PLUGINS];
const LEGACY_PLUGIN_IDS = ["@penglai/context"];
const HIDDEN_INTERNAL_CARD_IDS = [
  "@penglai/context",
  "@penglai/plugin-reference",
  "@penglai/plugin-pilot",
  "@penglai/budget",
];
const capturePublicShots = process.env.PENGLAI_CAPTURE_PUBLIC_SHOTS === "1";

const outDir = join(ROOT, "evidence/generated");
mkdirSync(outDir, { recursive: true });
const recPath = join(outDir, "u3-first-party-plugins.json");

const source = requireCleanCandidateSource();
if (!source.ok) {
  finish("STALE", {
    command: "u3-first-party-plugins",
    reason: source.reason,
    ...source.git,
  });
}
const git = source.git;

const target = parseTargetArg();
const targetRecPath = join(outDir, evidenceName("u3-first-party-plugins", target));
const writeRec = (value) => {
  writeEvidenceJson(recPath, value);
  writeEvidenceJson(targetRecPath, value);
};
const blocked = nativeBlocked("u3-first-party-plugins", target);
if (blocked) finish("BLOCKED", { command: "u3-first-party-plugins", ...blocked });
const installer = installerForTarget(target);
const installedRoot = join(ROOT, ".tmp", "u3-plugin-app");
const userData = join(ROOT, ".tmp", "u3-plugin-profile");
const publicShotDir = join(ROOT, "evidence", "generated", "readme-shots");
const installed = await installFromExactInstaller(
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
const expectedSource = process.env.PENGLAI_EXPECTED_SOURCE_SHA ?? git.head;
const packaged = inspectPackagedCandidate({
  app: installed.app,
  candidateSha: expectedSource,
  expectedTarget: target,
});
if (packaged.verdict !== "PASS") {
  finish(packaged.verdict, {
    command: "u3-first-party-plugins",
    reason: packaged.reason,
  });
}
const harness = resolveInstalledUiHarness();
if (!harness) {
  finish("INCOMPLETE", {
    command: "u3-first-party-plugins",
    reason: "installed plugin compatibility requires a separate Electron harness",
    target,
  });
}

const resources = resourcesInside(installed.app, target);
const alpha2Home = join(userData, "dsh-homes", "dsh-v0.1.2-alpha.2");
const profilePatch = join(alpha2Home, "profiles", "web", "cordis.patch.yml");
const inventoryPath = join(userData, "plugins", "inventory-snapshot.json");
const packageRoot = join(alpha2Home, "profiles", "web", "node_modules", "@penglai");
const dshNeedle = resolve(join(resources, "runtime/dsh/lib/bin.js"));
rmSync(userData, { recursive: true, force: true });
mkdirSync(userData, { recursive: true });
if (capturePublicShots) {
  rmSync(publicShotDir, { recursive: true, force: true });
  mkdirSync(publicShotDir, { recursive: true, mode: 0o700 });
}
const onboardingDir = join(userData, "onboarding");
mkdirSync(onboardingDir, { recursive: true, mode: 0o700 });
const fixtureWorkspaceId = "installed-ui-fixture-workspace";
const fixtureApiSessionId = "installed-ui-fixture-api";
const fixtureFirstSessionId = "installed-ui-fixture-first";
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
      advanceToken: "installed-product-ui-fixture",
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
      credentialRef: "DEEPSEEK_API_KEY",
      workspaceId: fixtureWorkspaceId,
      apiTest: {
        nonceDigest: fixtureNonceDigest,
        finalDigest: "b".repeat(64),
        sessionId: fixtureApiSessionId,
      },
      firstConversation: {
        sessionId: fixtureFirstSessionId,
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
const dshCohort = JSON.parse(
  readFileSync(join(ROOT, "docs/0.5.9/DSH_NPM_COHORT.json"), "utf8"),
);
const fixtureDshHome = join(userData, "dsh-home");
mkdirSync(fixtureDshHome, { recursive: true, mode: 0o700 });
writeFileSync(
  join(fixtureDshHome, ".credentials.yaml"),
  "DEEPSEEK_API_KEY: penglai-test-fixture-key-not-real\n",
  { mode: 0o600 },
);
writeFileSync(
  join(fixtureDshHome, "settings.yaml"),
  [
    "locale:",
    "  preference: zh",
    "ui-theme:",
    "  preference: system",
    "ui-onboarding:",
    `  welcomeNoticeVersion: ${dshCohort.upstreamFacts.welcomeNotice.version}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

function pluginRows(snapshot) {
  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  return TRACKED_PLUGINS.map((id) => {
    const hit = entries.find((row) => row?.moduleName === id);
    return {
      id,
      present: Boolean(hit),
      enabled: hit?.enabled === true,
      phase: hit?.fiberPhase ?? null,
    };
  });
}

function inventoryHasLegacyPlugin(snapshot) {
  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  return entries.some((row) => LEGACY_PLUGIN_IDS.includes(row?.moduleName));
}

function requiredRowOk(row) {
  return Boolean(row?.present && row.enabled && row.phase === "active");
}

function optionalRowOk(row, enabled) {
  if (!row?.present) return false;
  if (enabled) return row.enabled === true && row.phase === "active";
  return row.enabled !== true && row.phase === null;
}

function rowsMatch(snapshot, optionalEnabled) {
  const rows = pluginRows(snapshot);
  return (
    REQUIRED_BUILTIN.every((id) => requiredRowOk(rows.find((row) => row.id === id))) &&
    OPTIONAL_PLUGINS.every((id) => optionalRowOk(rows.find((row) => row.id === id), optionalEnabled))
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

function setOptionalEnabled(enabled) {
  let text = readFileSync(profilePatch, "utf8");
  for (const id of OPTIONAL_PLUGINS) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^\\s+name:\\s+["']?${escaped}["']?\\s*\\r?\\n\\s+disabled:\\s+)(true|false)`, "m");
    if (!pattern.test(text)) throw new Error(`installed profile is missing optional ${id}`);
    text = text.replace(pattern, `$1${enabled ? "false" : "true"}`);
  }
  for (const id of REQUIRED_BUILTIN) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const disabled = new RegExp(`name:\\s+["']?${escaped}["']?\\s*\\r?\\n\\s+disabled:\\s+true`, "m");
    if (disabled.test(text)) throw new Error(`required-builtin ${id} must stay enabled`);
  }
  writeFileSync(profilePatch, text, { mode: 0o600 });
}

function installedPackages() {
  return TRACKED_PLUGINS.map((id) => {
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

function requiredPackagesOk(packages) {
  return REQUIRED_BUILTIN.every((id) => {
    const pkg = packages.find((row) => row.id === id);
    return pkg?.present && pkg.version === "0.5.9";
  });
}

function optionalPackagesOk(packages, enabled) {
  if (!enabled) return true;
  return OPTIONAL_PLUGINS.every((id) => {
    const pkg = packages.find((row) => row.id === id);
    return pkg?.present && pkg.version === "0.5.9";
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
  let productWalk = null;
  try {
    const { session } = await attachPage(debugPort, 90_000);
    cdpSession = session;
    official = await observeOfficialSurfaces(session);
    if (
      (name === "fresh-default-disabled" || name === "all-enabled-after-restart") &&
      official?.official
    ) {
      productWalk = await walkInstalledBrowserWindow(session, {
        userData,
        shotDir:
          capturePublicShots && name === "all-enabled-after-restart"
            ? publicShotDir
            : undefined,
        requireOptionalPlugins: name === "all-enabled-after-restart",
      });
    }
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
      mounted: official?.official === true,
      bootOverlay: official?.snap?.bootOverlay === true,
      bootFailure: official?.snap?.bootFailure || undefined,
    },
    settingsNavigation: productWalk?.steps
      ?.filter((step) => String(step?.id || "").startsWith("ui-"))
      .map((step) => ({
        id: step.id,
        click: step.click
          ? {
              ok: step.click.ok === true,
              reason: step.click.reason || undefined,
              text: step.click.text || undefined,
            }
          : undefined,
        observed: step.observed === true,
        navLabels: step.snap?.navLabels ?? [],
      })),
    requiredCapabilities:
      name === "fresh-default-disabled"
        ? {
            memoryReady:
              productWalk?.steps?.find((step) => step.id === "ui-memory")
                ?.snap?.memoryStatus === "ready",
            authorizedSourcesEmbedded:
              productWalk?.steps?.find((step) => step.id === "ui-memory")
                ?.snap?.memorySources === true,
            hiddenInternalCardsAbsent: !(
              productWalk?.steps
                ?.find((step) => step.id === "ui-center")
                ?.snap?.pluginCards ?? []
            ).some((row) => HIDDEN_INTERNAL_CARD_IDS.includes(row?.id)),
            settingsBlocked: productWalk?.blocked ?? ["settings-walk-missing"],
          }
        : undefined,
    enabledCapabilities:
      name === "all-enabled-after-restart"
        ? {
            optionalSettingsReady: ["ui-im", "ui-asr", "ui-tts", "ui-companion"].every(
              (id) => productWalk?.settingsWalked?.includes(id),
            ),
            settingsBlocked: productWalk?.blocked ?? ["settings-walk-missing"],
          }
        : undefined,
    legacyPluginPresent: inventoryHasLegacyPlugin(inventory),
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
  setOptionalEnabled(true);
  phases.push(await runPhase("all-enabled", true));
  phases.push(await runPhase("all-enabled-after-restart", true));
  setOptionalEnabled(false);
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
    phase.official.mounted &&
    phase.processTree.ownedAbsolute &&
    phase.processTree.dshPid > 0 &&
    phase.processTree.leftovers === 0 &&
    phase.legacyPluginPresent === false,
);
const requiredCapabilitiesOk =
  phases[0]?.requiredCapabilities?.memoryReady === true &&
  phases[0]?.requiredCapabilities?.authorizedSourcesEmbedded === true &&
  phases[0]?.requiredCapabilities?.hiddenInternalCardsAbsent === true &&
  phases[0]?.requiredCapabilities?.settingsBlocked?.length === 0;
const enabledCapabilitiesOk =
  phases.find((phase) => phase.name === "all-enabled-after-restart")
    ?.enabledCapabilities?.optionalSettingsReady === true &&
  phases.find((phase) => phase.name === "all-enabled-after-restart")
    ?.enabledCapabilities?.settingsBlocked?.length === 0;
const activeOk = activePhases.every(
  (phase) =>
    rowsMatch({ entries: phase.rows.map((row) => ({ moduleName: row.id, enabled: row.enabled, fiberPhase: row.phase })) }, true) &&
    requiredPackagesOk(phase.packages) &&
    optionalPackagesOk(phase.packages, true),
);
const disabledOk = disabledPhases.every(
  (phase) =>
    rowsMatch({ entries: phase.rows.map((row) => ({ moduleName: row.id, enabled: row.enabled, fiberPhase: row.phase })) }, false) &&
    requiredPackagesOk(phase.packages),
);
const ok = commonOk && requiredCapabilitiesOk && enabledCapabilitiesOk && activeOk && disabledOk;
const rec = {
  command: "u3-first-party-plugins",
  verdict: ok ? "PASS" : "FAIL",
  installer,
  installerSha256: installed.installerSha256,
  sourceSha: packaged.release.sourceSha,
  target,
  dsh: packaged.release.dsh,
  plugins: TRACKED_PLUGINS,
  requiredBuiltin: REQUIRED_BUILTIN,
  rejectedLegacyPlugins: LEGACY_PLUGIN_IDS,
  hiddenInternalCards: HIDDEN_INTERNAL_CARD_IDS,
  publicScreenshots: capturePublicShots,
  optionalPlugins: OPTIONAL_PLUGINS,
  method:
    "exact installed profile with a local secret-free COMPLETE onboarding fixture; mounted official DSH product UI plus HTTP/WebSocket, capability-ready Memory settings, and loader inventory; Office+Memory stay required-builtin active; enable optional plugins; restart and walk every optional settings surface; disable optional plugins; restart",
  phases,
};
writeRec(rec);
if (!ok) finish("FAIL", rec);
finish("PASS", rec);
