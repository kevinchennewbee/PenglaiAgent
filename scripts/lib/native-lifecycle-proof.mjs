import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { requestBrowserClose } from "./installed-app.mjs";
import { PINNED_DSH } from "./product.mjs";

export const WINDOWS_DEFAULT_APP_SEGMENTS = ["Penglai", "app", "0.5"];
export const WINDOWS_DEFAULT_USERDATA_SEGMENTS = ["Penglai", "0.5"];
export const FRESH_LIFECYCLE_SENTINEL_NAME = "penglai-fresh-lifecycle-owner-sentinel.txt";
export const CURRENT_DSH_HOME_VERSION = PINNED_DSH;
export const CURRENT_DSH_HOME_RELATIVE = `dsh-homes/dsh-v${PINNED_DSH}`;
export const OWNER_PROFILE_MARKERS = Object.freeze([
  "dsh-home-active.json",
  "dsh-homes",
  "dsh-home",
  ".credentials.yaml",
  "onboarding",
]);
export const GRACEFUL_SHUTDOWN_METHODS = Object.freeze({
  "darwin-aarch64": ["browser-close", "posix-sigterm"],
  "darwin-x86_64": ["browser-close", "posix-sigterm"],
  "win32-x86_64": ["browser-close", "windows-wm-close"],
});

const HEX64 = /^[0-9a-f]{64}$/;
const FORCED_METHODS = new Set(["sigkill", "taskkill-force", "node-sigterm-windows"]);
const FORCED_SIGNALS = new Set(["SIGKILL"]);

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function windowsDefaultInstallDir(localAppData) {
  if (!localAppData) return "";
  return join(String(localAppData), ...WINDOWS_DEFAULT_APP_SEGMENTS);
}

export function windowsDefaultUserDataDir(localAppData) {
  if (!localAppData) return "";
  return join(String(localAppData), ...WINDOWS_DEFAULT_USERDATA_SEGMENTS);
}

export function windowsUpdateCacheDir(localAppData) {
  if (!localAppData) return "";
  return join(windowsDefaultUserDataDir(localAppData), "cache", "updates");
}

export function nsisDefaultInstallDir(nsis) {
  return /InstallDir "\$LOCALAPPDATA\\Penglai\\app\\0\.5"/.test(String(nsis ?? ""))
    ? String.raw`$LOCALAPPDATA\Penglai\app\0.5`
    : "";
}

export function nsisUninstallKeepsCustomInstdir(nsis) {
  const text = String(nsis ?? "");
  const un = text.slice(text.indexOf('Section "un.Penglai"'));
  return (
    /StrCpy \$R1 "\$LOCALAPPDATA\\Penglai\\app\\0\.5"/.test(un) &&
    /\$R0 S== \$R1/.test(un) &&
    /Keeping custom install directory/.test(un)
  );
}

export function windowsFreshLifecyclePathContract({ nsis, freshGate, helper, proofHelper = "" }) {
  const errors = [];
  if (nsisDefaultInstallDir(nsis) !== String.raw`$LOCALAPPDATA\Penglai\app\0.5`) {
    errors.push("NSIS default INSTDIR is not $LOCALAPPDATA\\Penglai\\app\\0.5");
  }
  if (!nsisUninstallKeepsCustomInstdir(nsis)) {
    errors.push("NSIS uninstall must keep custom INSTDIR and only RMDir the default app tree");
  }
  const windowsInstallFn = freshGate.slice(
    freshGate.indexOf("function installWindowsDefault"),
    freshGate.indexOf("async function shutdownFresh"),
  );
  if (!windowsInstallFn || !/spawnSync\(installer, \["\/S"\]/.test(windowsInstallFn)) {
    errors.push("fresh Windows gate must silent-install the default native path with /S only");
  }
  if (/\/D=/.test(windowsInstallFn) || /installFromExactInstaller/.test(windowsInstallFn)) {
    errors.push("fresh Windows gate must not pass /D= or installFromExactInstaller for NSIS");
  }
  if (!/Penglai", "app", "0\.5"/.test(freshGate) && !/WINDOWS_DEFAULT_APP_SEGMENTS/.test(freshGate)) {
    errors.push("fresh Windows gate must use the exact default native install path");
  }
  const gateAndProof = `${freshGate}\n${proofHelper}`;
  if (!/refusing to overwrite an existing Penglai install/.test(gateAndProof)) {
    errors.push("fresh Windows gate must refuse an existing unowned install");
  }
  const preflightCall = freshGate.indexOf("windowsFreshProfilePreflight");
  const sentinelAt = freshGate.indexOf("writeFileSync(sentinelPath");
  if (preflightCall < 0 || sentinelAt < 0 || preflightCall > sentinelAt) {
    errors.push("Windows existing-install preflight must run before sentinel writes");
  }
  if (!/unowned existing Penglai profile/.test(gateAndProof) || !/contradictory PENGLAI_USER_DATA/.test(gateAndProof)) {
    errors.push("Windows preflight must refuse unowned profile and inherited profile overrides");
  }
  if (/removeTreeNoFollow\(app\)/.test(freshGate)) {
    errors.push("fresh gate must not delete INSTDIR payload to manufacture uninstall PASS");
  }
  if (!/\/D=\$\{destRoot\}/.test(helper)) {
    errors.push("installed helper still owns the custom-directory /D= path for I01 fixtures");
  }
  return errors;
}

export function readExactSentinel(path, expectedSha256) {
  if (!path || !existsSync(path)) return { ok: false, reason: "missing" };
  const bytes = readFileSync(path);
  const sha256 = sha256Bytes(bytes);
  if (expectedSha256 && sha256 !== expectedSha256) return { ok: false, reason: "changed", sha256, size: bytes.length };
  return { ok: true, sha256, size: bytes.length };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function stableInventoryBody(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const { launchNonce: _nonce, dshPid: _pid, at: _at, ...stable } = snapshot;
  return stable;
}

export function stableInventoryIdentity(snapshot) {
  const body = stableInventoryBody(snapshot);
  if (!body || !Array.isArray(body.entries)) return { ok: false, reason: "missing inventory snapshot", digest: "" };
  return { ok: true, digest: sha256Bytes(Buffer.from(JSON.stringify(canonicalJson(body)))) };
}

export function processBoundLaunchIdentity(snapshot) {
  const nonce = String(snapshot?.launchNonce ?? "");
  const dshPid = snapshot?.dshPid;
  if (!nonce || !Number.isSafeInteger(dshPid) || dshPid <= 0) {
    return { ok: false, reason: "missing process-bound launch identity", launchNonce: "", dshPid: 0 };
  }
  return { ok: true, launchNonce: nonce, dshPid };
}

export function readCurrentGenerationIdentity(userRoot) {
  const root = resolve(String(userRoot ?? ""));
  const activePath = join(root, "dsh-home-active.json");
  if (!existsSync(activePath)) {
    return {
      ok: false,
      reason: "absent current generation identity",
      activeVersion: "",
      homeRelative: "",
      homePresent: false,
      activationKind: "",
    };
  }
  let value;
  try {
    value = JSON.parse(readFileSync(activePath, "utf8"));
  } catch {
    return { ok: false, reason: "malformed current generation identity", activeVersion: "", homeRelative: "", homePresent: false, activationKind: "" };
  }
  const activeVersion = String(value?.activeVersion ?? "");
  const homeRelative = String(value?.homeRelative ?? "").replaceAll("\\", "/");
  const activationKind = value?.activationKind == null ? "" : String(value.activationKind);
  if (
    value?.schema !== 1 ||
    activeVersion !== CURRENT_DSH_HOME_VERSION ||
    homeRelative !== CURRENT_DSH_HOME_RELATIVE ||
    isAbsolute(String(value?.homeRelative ?? "")) ||
    String(value?.homeRelative ?? "").split(/[\\/]/u).includes("..") ||
    (activationKind && activationKind !== "fresh" && activationKind !== "migration")
  ) {
    return {
      ok: false,
      reason: "unsupported current generation identity",
      activeVersion,
      homeRelative,
      homePresent: false,
      activationKind,
    };
  }
  const home = resolve(root, homeRelative);
  const rel = relative(root, home);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, reason: "unsupported current generation identity", activeVersion, homeRelative, homePresent: false, activationKind };
  }
  let homePresent = false;
  try {
    const st = lstatSync(home);
    homePresent = st.isDirectory() && !st.isSymbolicLink();
  } catch {
    homePresent = false;
  }
  if (!homePresent) {
    return { ok: false, reason: "absent current generation home", activeVersion, homeRelative, homePresent: false, activationKind };
  }
  return { ok: true, reason: "", activeVersion, homeRelative, homePresent: true, activationKind };
}

export function currentGenerationProfileIdentity(userData) {
  const generation = readCurrentGenerationIdentity(userData);
  const snapshotPath = join(userData, "plugins", "inventory-snapshot.json");
  let snapshot = null;
  if (existsSync(snapshotPath)) {
    try {
      snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    } catch {
      snapshot = null;
    }
  }
  const stable = stableInventoryIdentity(snapshot);
  const launch = processBoundLaunchIdentity(snapshot);
  const ok = generation.ok === true && stable.ok === true && launch.ok === true;
  return {
    generation,
    stable: { digest: stable.digest, inventoryOk: snapshot?.ok === true },
    launch: { launchNonce: launch.launchNonce, dshPid: launch.dshPid },
    onboardingCompleted: false,
    ok,
    reason: ok ? "" : generation.ok ? (stable.ok ? launch.reason : stable.reason) : generation.reason,
  };
}

export function launchIdentityChanged(previous, current) {
  const before = previous?.launch ?? {};
  const after = current?.launch ?? {};
  return Boolean(
    before.launchNonce &&
      after.launchNonce &&
      Number.isSafeInteger(before.dshPid) &&
      Number.isSafeInteger(after.dshPid) &&
      before.dshPid > 0 &&
      after.dshPid > 0 &&
      before.launchNonce !== after.launchNonce &&
      before.dshPid !== after.dshPid,
  );
}

export function persistedRestartMatches(previous, current) {
  return profileRestartProblems(previous, current).length === 0;
}

export function profileRestartProblems(previous, current) {
  const problems = [];
  if (!previous?.generation?.ok || !current?.generation?.ok || !previous.generation.homePresent || !current.generation.homePresent) {
    problems.push("absent current generation identity");
  } else if (
    previous.generation.activeVersion !== CURRENT_DSH_HOME_VERSION ||
    current.generation.activeVersion !== CURRENT_DSH_HOME_VERSION ||
    previous.generation.homeRelative !== CURRENT_DSH_HOME_RELATIVE ||
    current.generation.homeRelative !== CURRENT_DSH_HOME_RELATIVE
  ) {
    problems.push("absent current generation identity");
  }
  if (!HEX64.test(String(previous?.stable?.digest ?? "")) || previous?.stable?.digest !== current?.stable?.digest) {
    problems.push("changed stable generation state");
  }
  if (!launchIdentityChanged(previous, current)) problems.push("stale process-bound readiness");
  if (previous?.onboardingCompleted === true || current?.onboardingCompleted === true) {
    problems.push("fabricated/deferred native PASS");
  }
  return [...new Set(problems)];
}

export function windowsOwnerProfileMarkers(userData) {
  return OWNER_PROFILE_MARKERS.filter((name) => existsSync(join(userData, name)));
}

export function windowsInheritedProfileOverride(env, expectedUserData) {
  const override = env?.PENGLAI_USER_DATA;
  if (!override) return "";
  if (resolve(String(override)) === resolve(String(expectedUserData))) return "";
  return String(override);
}

export function windowsFreshProfilePreflight({ localAppData, env = process.env, installExists, registeredInstallDir } = {}) {
  const expectedApp = windowsDefaultInstallDir(localAppData);
  const expectedUser = windowsDefaultUserDataDir(localAppData);
  const override = windowsInheritedProfileOverride(env, expectedUser);
  if (override) {
    return { ok: false, reason: "contradictory PENGLAI_USER_DATA override", expectedUser, override, expectedApp };
  }
  if (registeredInstallDir) {
    const registered = resolve(String(registeredInstallDir));
    if (registered.toLowerCase() !== resolve(expectedApp).toLowerCase()) {
      return { ok: false, reason: "unowned custom Penglai install", registered, expectedApp };
    }
  }
  if (installExists === true || (installExists == null && expectedApp && existsSync(expectedApp))) {
    return { ok: false, reason: "refusing to overwrite an existing Penglai install", expectedApp };
  }
  const markers = expectedUser && existsSync(expectedUser) ? windowsOwnerProfileMarkers(expectedUser) : [];
  if (markers.length) {
    return { ok: false, reason: "unowned existing Penglai profile", expectedUser, markers };
  }
  return { ok: true, expectedApp, expectedUser };
}

export function classifyApplicationShutdown(observation, target) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    return { graceful: false, reason: "missing shutdown proof" };
  }
  const method = String(observation.method ?? "");
  const allowed = GRACEFUL_SHUTDOWN_METHODS[target] ?? [];
  if (observation.forced === true || FORCED_METHODS.has(method) || FORCED_SIGNALS.has(observation.signal)) {
    return { graceful: false, reason: "forced process termination" };
  }
  if (method === "node-sigterm-windows" || (target === "win32-x86_64" && method === "posix-sigterm")) {
    return { graceful: false, reason: "node SIGTERM is not a normal Windows app quit" };
  }
  if (observation.requestedClose !== true || !allowed.includes(method)) {
    return { graceful: false, reason: "missing application close request" };
  }
  if (observation.exitCode !== 0 || observation.signal != null) {
    return { graceful: false, reason: "abnormal exit" };
  }
  if (observation.graceful === true && (observation.forced === true || FORCED_SIGNALS.has(observation.signal))) {
    return { graceful: false, reason: "fabricated graceful shutdown" };
  }
  return { graceful: true, reason: "" };
}

export async function waitForChildExitNoKill(child, timeoutMs = 20_000) {
  if (child.exitCode !== null || child.signalCode) {
    return { code: child.exitCode, signal: child.signalCode, timedOut: false, forced: false };
  }
  const closed = new Promise((resolveClose) =>
    child.once("close", (code, signal) => resolveClose({ code, signal })),
  );
  const raced = await Promise.race([
    closed.then((value) => ({ exited: true, value })),
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout({ exited: false }), timeoutMs)),
  ]);
  if (!raced.exited) return { code: null, signal: null, timedOut: true, forced: false };
  return { ...raced.value, timedOut: false, forced: false };
}

export async function requestNativeApplicationClose(child, { platform = process.platform, session } = {}) {
  if (session) {
    const requested = await requestBrowserClose(session);
    return { method: "browser-close", requestedClose: requested === true };
  }
  if (platform === "win32") {
    if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) {
      return { method: "windows-wm-close", requestedClose: false };
    }
    const closed = spawnSync("taskkill.exe", ["/PID", String(child.pid)], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
    return { method: "windows-wm-close", requestedClose: closed.status === 0 || closed.status === 128 };
  }
  try {
    child.kill("SIGTERM");
    return { method: "posix-sigterm", requestedClose: true };
  } catch {
    return { method: "posix-sigterm", requestedClose: false };
  }
}

export function hostFactsMatchTarget(host, target) {
  if (!host || typeof host !== "object") return false;
  if (target === "darwin-aarch64") return host.platform === "darwin" && host.arch === "arm64";
  if (target === "darwin-x86_64") return host.platform === "darwin" && host.arch === "x64";
  if (target === "win32-x86_64") return host.platform === "win32" && host.arch === "x64";
  return false;
}

export function windowsDestinationIsDefaultInstdir(destination) {
  const normalized = String(destination ?? "").replaceAll("\\", "/").replace(/\/+$/u, "");
  return /\/Penglai\/app\/0\.5$/i.test(normalized) && !/\.tmp\/fresh-install-uninstall/i.test(normalized);
}
