import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  mkdtempSync,
} from "node:fs";
import { join, resolve, win32 as win32Path } from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { ROOT } from "./repo.mjs";
import { installerForTarget } from "./release-targets.mjs";

export const ARM64_DMG = join(ROOT, "dist/Penglai_0.5.9_macos_aarch64.dmg");
export const ARM64_INSTALLER = "Penglai_0.5.9_macos_aarch64.dmg";

export function leftoversByCommand(needle) {
  if (process.platform === "win32") {
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.CommandLine }",
      ],
      { encoding: "utf8" },
    );
    return String(r.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(needle));
  }
  const r = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" });
  return String(r.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(needle));
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function retryTransientWindowsFs(operation) {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (error?.code === "ENOENT") return;
      if (
        attempt >= 119 ||
        !new Set(["EACCES", "EBUSY", "ENOTEMPTY", "EPERM"]).has(error?.code)
      ) {
        throw error;
      }
      Atomics.wait(sleeper, 0, 0, Math.min(50 + attempt * 10, 250));
    }
  }
}

export function removeTreeNoFollow(path) {
  const stat = retryTransientWindowsFs(() => lstatSync(path));
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    retryTransientWindowsFs(() => unlinkSync(path));
    return;
  }
  for (const name of retryTransientWindowsFs(() => readdirSync(path)) ?? []) {
    removeTreeNoFollow(join(path, name));
  }
  retryTransientWindowsFs(() => rmdirSync(path));
}

const WINDOWS_PRODUCT_KEY = "HKCU\\Software\\Penglai\\0.5";
const WINDOWS_UNINSTALL_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Penglai.DSH.0.5";

function queryWindowsRegistryValue(key, name) {
  const queried = spawnSync("reg.exe", ["query", key, "/v", name], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  if (queried.status !== 0) return "";
  const row = String(queried.stdout ?? "")
    .split(/\r?\n/u)
    .find((line) => new RegExp(`^\\s*${name}\\s+REG_(?:SZ|EXPAND_SZ)\\s+`, "iu").test(line));
  return row?.replace(new RegExp(`^\\s*${name}\\s+REG_(?:SZ|EXPAND_SZ)\\s+`, "iu"), "").trim() ?? "";
}

export function windowsFixtureRemovalObserved({ installDirExists, registeredInstallDir, uninstallCommand }) {
  return !installDirExists && !registeredInstallDir && !uninstallCommand;
}

function waitForWindowsProductRegistryClear(timeoutMs) {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + timeoutMs;
  let stableSince = 0;
  do {
    const registeredInstallDir = queryWindowsRegistryValue(WINDOWS_PRODUCT_KEY, "InstallDir");
    const uninstallCommand = queryWindowsRegistryValue(WINDOWS_UNINSTALL_KEY, "UninstallString");
    if (!registeredInstallDir && !uninstallCommand) {
      stableSince ||= Date.now();
      if (Date.now() - stableSince >= 1_000) return true;
    } else {
      stableSince = 0;
    }
    Atomics.wait(sleeper, 0, 0, 250);
  } while (Date.now() < deadline);
  return false;
}

export function isControlledWindowsInstallerFixture(installDir, root = ROOT, temporaryRoot = tmpdir()) {
  const candidate = win32Path.resolve(String(installDir ?? ""));
  const workspace = win32Path.resolve(String(root ?? ""));
  const rel = win32Path.relative(workspace, candidate);
  if (rel && rel !== ".." && !rel.startsWith("..\\") && !win32Path.isAbsolute(rel)) {
    const segments = rel.split("\\");
    if (segments[0] === ".tmp" || segments[0].startsWith(".tmp-")) return true;
    if (rel.toLowerCase() === "dist\\penglai-v0.5.9-win32-x64\\penglai") return true;
  }
  const temporary = win32Path.resolve(String(temporaryRoot ?? ""));
  const temporaryRel = win32Path.relative(temporary, candidate);
  if (!temporaryRel || temporaryRel === ".." || temporaryRel.startsWith("..\\") || win32Path.isAbsolute(temporaryRel)) {
    return false;
  }
  const temporarySegments = temporaryRel.split("\\");
  return (
    temporarySegments.length === 2 &&
    temporarySegments[0].startsWith("penglai-windows-installer-fixture-") &&
    temporarySegments[1].toLowerCase() === "penglai"
  );
}

export function cleanupRegisteredWindowsInstallerFixture() {
  if (process.platform !== "win32") return { ok: true, cleaned: false };
  const installDir = queryWindowsRegistryValue(WINDOWS_PRODUCT_KEY, "InstallDir");
  const uninstallCommand = queryWindowsRegistryValue(WINDOWS_UNINSTALL_KEY, "UninstallString");
  if (!installDir && !uninstallCommand) return { ok: true, cleaned: false };
  if (!installDir || !uninstallCommand) {
    return { ok: false, cleaned: false, reason: "incomplete Penglai installer registry identity" };
  }
  if (!isControlledWindowsInstallerFixture(installDir)) {
    return {
      ok: false,
      cleaned: false,
      reason: "refusing to alter a Penglai install outside a dedicated release-test fixture",
    };
  }
  const uninstaller = uninstallCommand.replace(/^"|"$/gu, "");
  if (win32Path.resolve(uninstaller).toLowerCase() !== win32Path.resolve(installDir, "Uninstall.exe").toLowerCase()) {
    return { ok: false, cleaned: false, reason: "registered Penglai uninstaller does not match its fixture" };
  }
  if (!existsSync(uninstaller)) {
    return { ok: false, cleaned: false, reason: "registered Penglai fixture uninstaller is missing" };
  }
  // Keep the uninstaller in this exact controlled fixture so spawnSync waits
  // for the real process rather than an asynchronous temporary child. Product
  // policy intentionally preserves custom install directories; after registry
  // cleanup, remove this separately validated test fixture ourselves.
  const removed = spawnSync(uninstaller, ["/S", `_?=${installDir}`], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 120_000,
  });
  if (removed.status !== 0 || removed.error) {
    return { ok: false, cleaned: false, reason: "registered Penglai fixture uninstall failed" };
  }
  if (!waitForWindowsProductRegistryClear(30_000)) {
    return {
      ok: false,
      cleaned: false,
      reason: "registered Penglai fixture uninstall left product registry state",
    };
  }
  removeTreeNoFollow(installDir);
  const fullyRemoved = windowsFixtureRemovalObserved({
    installDirExists: existsSync(installDir),
    registeredInstallDir: queryWindowsRegistryValue(WINDOWS_PRODUCT_KEY, "InstallDir"),
    uninstallCommand: queryWindowsRegistryValue(WINDOWS_UNINSTALL_KEY, "UninstallString"),
  });
  if (!fullyRemoved) {
    return { ok: false, cleaned: false, reason: "registered Penglai fixture cleanup left install state" };
  }
  return { ok: true, cleaned: true, installDir };
}

export function installFromExactDmg(dmgPath, destRoot, installerName = ARM64_INSTALLER) {
  if (!existsSync(dmgPath)) return { ok: false, reason: `${installerName} missing` };
  const sha = sha256File(dmgPath);
  const mount = mkdtempSync(join(tmpdir(), "penglai-exact-dmg-"));
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(destRoot, { recursive: true });
  try {
    execFileSync("hdiutil", ["attach", dmgPath, "-nobrowse", "-readonly", "-mountpoint", mount], { stdio: "inherit" });
    const src = join(mount, "Penglai.app");
    if (!existsSync(join(src, "Contents", "Info.plist"))) {
      return { ok: false, reason: "DMG does not contain Penglai.app", installerSha256: sha };
    }
    const dest = join(destRoot, "Penglai.app");
    execFileSync("ditto", [src, dest]);
    return { ok: true, app: dest, installerSha256: sha, installer: installerName };
  } finally {
    spawnSync("hdiutil", ["detach", mount, "-force"], { stdio: "inherit" });
    rmSync(mount, { recursive: true, force: true });
  }
}

export async function waitForBoundedChild(child, timeoutMs) {
  return new Promise((resolveExit) => {
    let settled = false;
    let timedOut = false;
    let treeKilled = false;
    let closeTimer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(closeTimer);
      resolveExit(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && Number.isSafeInteger(child.pid) && child.pid > 0) {
        const killed = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          encoding: "utf8",
          windowsHide: true,
          timeout: 15_000,
        });
        treeKilled = killed.status === 0;
      } else {
        try {
          treeKilled = child.kill("SIGKILL");
        } catch {
          treeKilled = false;
        }
      }
      closeTimer = setTimeout(() => {
        finish({ code: null, signal: null, timedOut: true, treeKilled, closeObserved: false });
      }, 10_000);
    }, timeoutMs);
    child.once("error", (error) => {
      finish({ code: null, signal: null, timedOut, treeKilled, closeObserved: false, errorCode: error?.code ?? "SPAWN_ERROR" });
    });
    child.once("close", (code, signal) => {
      finish({ code, signal, timedOut, treeKilled, closeObserved: true });
    });
  });
}

export async function installFromExactInstaller(installerPath, destRoot, target) {
  const installer = installerForTarget(target);
  if (!existsSync(installerPath)) return { ok: false, reason: `${installer} missing` };
  if (target.startsWith("darwin-")) {
    if (process.platform !== "darwin") {
      return { ok: false, blocked: true, reason: "macOS installer can only be applied on darwin" };
    }
    return installFromExactDmg(installerPath, destRoot, installer);
  }
  if (process.platform !== "win32" || process.arch !== "x64") {
    return { ok: false, blocked: true, reason: "Windows installer can only be applied on win32-x64" };
  }
  const staleFixture = cleanupRegisteredWindowsInstallerFixture();
  if (!staleFixture.ok) {
    return { ok: false, reason: staleFixture.reason };
  }
  const sha = sha256File(installerPath);
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(destRoot, { recursive: true });
  const packed = spawn(installerPath, ["/S", `/D=${destRoot}`], {
    stdio: "ignore",
    windowsHide: true,
  });
  const installExit = await waitForBoundedChild(packed, 20 * 60_000);
  const app = existsSync(join(destRoot, "Penglai.exe")) ? destRoot : join(destRoot, "Penglai");
  if (installExit.timedOut || installExit.errorCode || installExit.code !== 0 || !existsSync(join(app, "Penglai.exe"))) {
    return {
      ok: false,
      reason: installExit.timedOut
        ? "NSIS silent install exceeded the bounded release timeout"
        : "NSIS silent install did not produce Penglai.exe",
      installerSha256: sha,
      installer,
      installExit,
    };
  }
  process.once("exit", () => {
    cleanupRegisteredWindowsInstallerFixture();
  });
  return { ok: true, app, installerSha256: sha, installer };
}

export function exeInside(app, target) {
  if (target === "win32-x86_64" || existsSync(join(app, "Penglai.exe"))) {
    const exe = join(app, "Penglai.exe");
    return existsSync(exe) ? exe : null;
  }
  const penglai = join(app, "Contents", "MacOS", "Penglai");
  if (existsSync(penglai)) return penglai;
  return null;
}

export function resourcesInside(app, target) {
  if (target === "win32-x86_64" || existsSync(join(app, "Penglai.exe"))) {
    return resolve(join(app, "resources"));
  }
  return resolve(join(app, "Contents", "Resources"));
}

export function readInstalledAppIdentity(app, target) {
  if (target === "win32-x86_64" || existsSync(join(app, "Penglai.exe"))) {
    const releasePath = join(app, "resources", "release-info.json");
    const release = existsSync(releasePath) ? JSON.parse(readFileSync(releasePath, "utf8")) : {};
    return {
      executable: existsSync(join(app, "Penglai.exe")) ? "Penglai" : "",
      shortVersion: String(release.productVersion ?? ""),
      version: String(release.productVersion ?? ""),
      bundleId: "com.penglai.dsh",
    };
  }
  const plist = readFileSync(join(app, "Contents", "Info.plist"), "utf8");
  const pick = (key) => {
    const re = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`);
    return re.exec(plist)?.[1] ?? "";
  };
  return {
    executable: pick("CFBundleExecutable"),
    shortVersion: pick("CFBundleShortVersionString"),
    version: pick("CFBundleVersion"),
    bundleId: pick("CFBundleIdentifier"),
  };
}

export function assertInstalledPenglaiIdentity(app, target) {
  const facts = readInstalledAppIdentity(app, target);
  if (facts.executable !== "Penglai") return { ok: false, reason: `executable ${facts.executable || "<empty>"}` };
  if (facts.shortVersion !== "0.5.9" || facts.version !== "0.5.9") {
    return { ok: false, reason: `version ${facts.shortVersion}/${facts.version}` };
  }
  if (facts.bundleId !== "com.penglai.dsh") return { ok: false, reason: `bundle ${facts.bundleId || "<empty>"}` };
  if (target !== "win32-x86_64" && !existsSync(join(app, "Penglai.exe"))) {
    const plist = readFileSync(join(app, "Contents", "Info.plist"), "utf8");
    const forbidden = [
      "NSAllowsArbitraryLoads",
      "NSAudioCaptureUsageDescription",
      "NSBluetoothAlwaysUsageDescription",
      "NSBluetoothPeripheralUsageDescription",
      "NSCameraUsageDescription",
    ].find((key) => plist.includes(`<key>${key}</key>`));
    if (forbidden) return { ok: false, reason: `unexpected macOS permission ${forbidden}` };
  }
  if (!exeInside(app, target)) return { ok: false, reason: "Penglai executable missing" };
  return { ok: true, facts };
}

export async function waitForFile(path, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (existsSync(path)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export function launchPackaged(exe, resources, userData, extraArgs = [], extraEnv = {}) {
  const child = spawn(exe, ["--disable-gpu", "--in-process-gpu", ...extraArgs], {
    env: installedHarnessEnvironment(resources, userData, extraEnv),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => {
    output += String(d);
  });
  child.stderr.on("data", (d) => {
    output += String(d);
  });
  return { child, output: () => output };
}

export function installedHarnessEnvironment(
  resources,
  userData,
  extraEnv = {},
  platform = process.platform,
  sourceEnv = process.env,
) {
  const common = {
    NODE_PATH: "",
    HOME: userData,
    PENGLAI_USER_DATA: userData,
    PENGLAI_RESOURCES: resources,
    PENGLAI_PLUGINS_DIR: join(resources, "plugins"),
  };
  if (platform !== "win32") {
    return { PATH: "/usr/bin:/bin", ...common, ...extraEnv };
  }
  const systemRoot = sourceEnv.SystemRoot || sourceEnv.WINDIR || "C:\\Windows";
  const temp = join(userData, "temp");
  const appData = join(userData, "AppData", "Roaming");
  const localAppData = join(userData, "AppData", "Local");
  for (const path of [temp, appData, localAppData]) {
    mkdirSync(path, { recursive: true });
  }
  return {
    PATH: `${join(systemRoot, "System32")};${systemRoot}`,
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    ComSpec: sourceEnv.ComSpec || join(systemRoot, "System32", "cmd.exe"),
    PATHEXT: sourceEnv.PATHEXT || ".COM;.EXE;.BAT;.CMD",
    ProgramData: sourceEnv.ProgramData || "C:\\ProgramData",
    USERPROFILE: userData,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    TEMP: temp,
    TMP: temp,
    ...common,
    ...extraEnv,
  };
}

export function resolveInstalledUiHarness() {
  const explicit = process.env.PENGLAI_INSTALLED_UI_HARNESS;
  if (explicit && existsSync(explicit)) return explicit;
  try {
    const require = createRequire(join(ROOT, "apps/desktop/package.json"));
    const bin = require("electron");
    if (typeof bin === "string" && existsSync(bin)) return bin;
  } catch {
    /* desktop electron is optional for source-only gates */
  }
  const hoisted =
    process.platform === "darwin"
      ? join(ROOT, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
      : join(ROOT, "node_modules", "electron", "dist", "electron.exe");
  if (existsSync(hoisted)) return hoisted;
  return undefined;
}

export function installedHarnessSpec(harnessExe, resources) {
  const executable = resolve(String(harnessExe ?? ""));
  const appEntry = resolve(join(resources, "app"));
  if (!harnessExe || !existsSync(executable)) {
    throw new Error("installed UI harness executable missing");
  }
  if (
    !existsSync(join(appEntry, "package.json")) ||
    !existsSync(join(appEntry, "electron-main.js"))
  ) {
    throw new Error("installed UI harness requires the exact installed resources/app");
  }
  return { executable, appEntry };
}

export function launchInstalledHarness(
  harnessExe,
  resources,
  userData,
  extraArgs = [],
  extraEnv = {},
) {
  const spec = installedHarnessSpec(harnessExe, resources);
  const child = spawn(
    spec.executable,
    ["--disable-gpu", "--in-process-gpu", ...extraArgs, spec.appEntry],
    {
      env: installedHarnessEnvironment(resources, userData, extraEnv),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (d) => {
    output += String(d);
  });
  child.stderr.on("data", (d) => {
    output += String(d);
  });
  return { child, output: () => output, spec };
}

export function ownedProcessTree(app, resources, electronPid) {
  const windows = existsSync(join(app, "Penglai.exe"));
  const nodeBin = resolve(join(resources, windows ? "runtime/node/node.exe" : "runtime/node/bin/node"));
  const dshEntry = resolve(join(resources, "runtime/dsh/lib/bin.js"));
  const lines = leftoversByCommand(dshEntry).filter((line) => line.includes(nodeBin));
  const dshPid = Number((lines[0] || "").split(/\s+/)[0]) || 0;
  return {
    electronPid,
    dshPid,
    nodeBin,
    dshEntry,
    ownedAbsolute: nodeBin.startsWith(resolve(resources)) && /[/\\]runtime[/\\]/.test(nodeBin),
  };
}

export function waitChildExit(child, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      resolve(child.exitCode ?? 1);
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

export async function requestBrowserClose(session, timeoutMs = 5_000) {
  if (!session) return false;
  try {
    await session.send("Browser.close", {}, timeoutMs);
    return true;
  } catch {
    return false;
  } finally {
    session.close();
  }
}

export async function stopChild(child, timeoutMs = 8_000) {
  if (child.exitCode !== null || child.signalCode) return [child.exitCode, child.signalCode];
  const closed = new Promise((resolveClose) =>
    child.once("close", (code, signal) => resolveClose([code, signal])),
  );
  try {
    child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  const graceful = await Promise.race([
    closed.then((value) => ({ exited: true, value })),
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout({ exited: false }), timeoutMs)),
  ]);
  if (graceful.exited) return graceful.value;
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
  const forced = await Promise.race([
    closed.then((value) => ({ exited: true, value })),
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout({ exited: false }), 5_000)),
  ]);
  if (!forced.exited) throw new Error(`child ${child.pid ?? "unknown"} did not exit after SIGKILL`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
  return forced.value;
}

export function signalPid(pid, signal, windowsHelper) {
  if (!pid) return false;
  if (process.platform === "win32") {
    if (!windowsHelper || !existsSync(windowsHelper)) return false;
    const command = signal === "SIGSTOP" ? "process-suspend" : signal === "SIGCONT" ? "process-resume" : "";
    if (!command) return false;
    const r = spawnSync(windowsHelper, [command, "--pid", String(pid)], { encoding: "utf8", windowsHide: true });
    if (r.status !== 0) return false;
    try {
      const report = JSON.parse(String(r.stdout ?? "").trim().split("\n").filter(Boolean).at(-1) ?? "{}");
      return report.ok === true && report.command === command && Number(report.changed) > 0;
    } catch {
      return false;
    }
  }
  const flag = String(signal).startsWith("SIG") ? `-${signal}` : `-${signal}`;
  const r = spawnSync("/bin/kill", [flag, String(pid)], { encoding: "utf8" });
  return r.status === 0;
}

export function findWelcomeAck(userData) {
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 6 || hits.length) return;
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (name.endsWith(".yaml") || name.endsWith(".yml") || name.endsWith(".json")) {
        try {
          const text = readFileSync(p, "utf8");
          if (text.includes("welcomeNoticeVersion")) hits.push(p.slice(userData.length));
        } catch {
          /* unreadable */
        }
      }
    }
  };
  if (existsSync(userData)) walk(userData, 0);
  return hits;
}
