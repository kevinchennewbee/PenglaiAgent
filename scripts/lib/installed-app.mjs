import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { ROOT } from "./repo.mjs";

export const ARM64_DMG = join(ROOT, "dist/Penglai_0.5.1_macos_aarch64.dmg");
export const ARM64_INSTALLER = "Penglai_0.5.1_macos_aarch64.dmg";

export function leftoversByCommand(needle) {
  const r = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" });
  return String(r.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(needle));
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function installFromExactDmg(dmgPath, destRoot) {
  if (!existsSync(dmgPath)) return { ok: false, reason: `${ARM64_INSTALLER} missing` };
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
    return { ok: true, app: dest, installerSha256: sha, installer: ARM64_INSTALLER };
  } finally {
    spawnSync("hdiutil", ["detach", mount, "-force"], { stdio: "inherit" });
    rmSync(mount, { recursive: true, force: true });
  }
}

export function exeInside(app) {
  const penglai = join(app, "Contents", "MacOS", "Penglai");
  if (existsSync(penglai)) return penglai;
  return null;
}

export function readInstalledAppIdentity(app) {
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

export function assertInstalledPenglaiIdentity(app) {
  const facts = readInstalledAppIdentity(app);
  if (facts.executable !== "Penglai") return { ok: false, reason: `executable ${facts.executable || "<empty>"}` };
  if (facts.shortVersion !== "0.5.1" || facts.version !== "0.5.1") {
    return { ok: false, reason: `version ${facts.shortVersion}/${facts.version}` };
  }
  if (facts.bundleId !== "com.penglai.dsh") return { ok: false, reason: `bundle ${facts.bundleId || "<empty>"}` };
  if (!exeInside(app)) return { ok: false, reason: "Penglai executable missing" };
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
    env: {
      PATH: "/usr/bin:/bin",
      NODE_PATH: "",
      HOME: userData,
      PENGLAI_USER_DATA: userData,
      PENGLAI_RESOURCES: resources,
      PENGLAI_PLUGINS_DIR: join(resources, "plugins"),
      ...extraEnv,
    },
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

export function ownedProcessTree(app, resources, electronPid) {
  const nodeBin = resolve(join(resources, "runtime/node/bin/node"));
  const dshEntry = resolve(join(resources, "runtime/dsh/lib/bin.js"));
  const lines = leftoversByCommand(dshEntry).filter((line) => line.includes(nodeBin));
  const dshPid = Number((lines[0] || "").split(/\s+/)[0]) || 0;
  return {
    electronPid,
    dshPid,
    nodeBin,
    dshEntry,
    ownedAbsolute: nodeBin.startsWith(resolve(join(app, "Contents", "Resources"))) && nodeBin.includes("/runtime/"),
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

export async function stopChild(child, timeoutMs = 8_000) {
  try {
    child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  const closed = await Promise.race([
    new Promise((resolveClose) => child.on("close", (c, s) => resolveClose([c, s]))),
    new Promise((resolveClose) =>
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* */
        }
        resolveClose([null, "SIGKILL"]);
      }, timeoutMs),
    ),
  ]);
  return closed;
}

export function signalPid(pid, signal) {
  if (!pid) return false;
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
