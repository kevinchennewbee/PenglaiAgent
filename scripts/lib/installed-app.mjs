import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { ROOT } from "./repo.mjs";
import { installerForTarget } from "./release-targets.mjs";

export const ARM64_DMG = join(ROOT, "dist/Penglai_0.5.2_macos_aarch64.dmg");
export const ARM64_INSTALLER = "Penglai_0.5.2_macos_aarch64.dmg";

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

export function installFromExactInstaller(installerPath, destRoot, target) {
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
  const sha = sha256File(installerPath);
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(destRoot, { recursive: true });
  const packed = spawnSync(installerPath, ["/S", `/D=${destRoot}`], { encoding: "utf8" });
  const app = existsSync(join(destRoot, "Penglai.exe")) ? destRoot : join(destRoot, "Penglai");
  if (packed.status !== 0 || !existsSync(join(app, "Penglai.exe"))) {
    return {
      ok: false,
      reason: "NSIS silent install did not produce Penglai.exe",
      installerSha256: sha,
      installer,
    };
  }
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
  if (facts.shortVersion !== "0.5.2" || facts.version !== "0.5.2") {
    return { ok: false, reason: `version ${facts.shortVersion}/${facts.version}` };
  }
  if (facts.bundleId !== "com.penglai.dsh") return { ok: false, reason: `bundle ${facts.bundleId || "<empty>"}` };
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
