import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requestBrowserClose } from "./installed-app.mjs";

export const WINDOWS_DEFAULT_APP_SEGMENTS = ["Penglai", "app", "0.5"];
export const WINDOWS_DEFAULT_USERDATA_SEGMENTS = ["Penglai", "0.5"];
export const FRESH_LIFECYCLE_SENTINEL_NAME = "penglai-fresh-lifecycle-owner-sentinel.txt";
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

export function windowsFreshLifecyclePathContract({ nsis, freshGate, helper }) {
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
  if (!/refusing to overwrite an existing Penglai install/.test(freshGate)) {
    errors.push("fresh Windows gate must refuse an existing unowned install");
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

export function profileIdentityFromUserData(userData) {
  const inventory = join(userData, "plugins", "inventory-snapshot.json");
  const dshHome = join(userData, "dsh-home");
  return {
    inventorySha256: existsSync(inventory) ? sha256Bytes(readFileSync(inventory)) : "",
    dshHomePresent: existsSync(dshHome),
  };
}

export function persistedRestartMatches(previous, current) {
  return Boolean(
    previous &&
      current &&
      HEX64.test(String(previous.inventorySha256 ?? "")) &&
      previous.inventorySha256 === current.inventorySha256 &&
      previous.dshHomePresent === current.dshHomePresent,
  );
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
