import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join, win32 } from "node:path";
import type { RuntimeLayout, UserLayout } from "./index.js";
import { writeFileAtomic } from "./permissions.js";
import { invokeWindowsHost, windowsNativeHostStatus, type WindowsHostReport } from "./windows-host.js";

export const USER_SCHEMA = 3;

export interface ProcessIdentity {
  pid: number;
  pgid: number;
  startMs: number;
  executable: string;
  dshEntry: string;
  port: number;
  startedAt: string;
  platform?: "darwin" | "win32";
  appRoot?: string;
  owner?: string;
  jobAssigned?: boolean;
  supervisorPid?: number;
  supervisorStartMs?: number;
  supervisorExecutable?: string;
}

export function identityPath(user: UserLayout): string {
  return join(user.logs, "dsh.identity.json");
}

function hostPlatform(id?: ProcessIdentity): NodeJS.Platform {
  if (id?.platform === "win32" || id?.platform === "darwin") return id.platform;
  return process.platform;
}

export function readProcessStartMs(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  appRoot?: string,
): number {
  if (pid <= 0) return 0;
  if (platform === "win32") {
    try {
      const report = invokeWindowsHost(["process-identity", "--pid", String(pid)], {
        platform: "win32",
        ...(appRoot ? { appRoot } : {}),
      });
      return typeof report.startMs === "number" && Number.isFinite(report.startMs) ? report.startMs : 0;
    } catch {
      return 0;
    }
  }
  try {
    const raw = execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" }).trim();
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

export function readProcessPgid(pid: number, platform: NodeJS.Platform = process.platform): number {
  if (platform === "win32") return pid;
  try {
    const raw = execFileSync("/bin/ps", ["-p", String(pid), "-o", "pgid="], { encoding: "utf8" }).trim();
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : pid;
  } catch {
    return pid;
  }
}

function windowsIdentityReport(pid: number, appRoot?: string): WindowsHostReport | undefined {
  try {
    return invokeWindowsHost(["process-identity", "--pid", String(pid)], {
      platform: "win32",
      ...(appRoot ? { appRoot } : {}),
    });
  } catch {
    return undefined;
  }
}

export function processStillMatches(id: ProcessIdentity): boolean {
  if (id.pid <= 0) return false;
  const platform = hostPlatform(id);
  if (platform === "win32") {
    const report = windowsIdentityReport(id.pid, id.appRoot);
    if (!report || !report.startMs) return false;
    if (report.startMs !== id.startMs) return false;
    if (!report.executable || win32.normalize(report.executable).toLowerCase() !== win32.normalize(id.executable).toLowerCase()) return false;
    if (id.owner && report.owner !== id.owner) return false;
    return true;
  }
  const start = readProcessStartMs(id.pid, "darwin");
  if (!start || start !== id.startMs) return false;
  try {
    const cmd = execFileSync("/bin/ps", ["-p", String(id.pid), "-o", "command="], { encoding: "utf8" });
    return cmd.includes(id.executable) && cmd.includes(id.dshEntry);
  } catch {
    return false;
  }
}

export function writeIdentity(user: UserLayout, id: ProcessIdentity): void {
  writeFileAtomic(identityPath(user), JSON.stringify(id, null, 2), 0o600);
}

export function readIdentity(user: UserLayout): ProcessIdentity | undefined {
  const p = identityPath(user);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ProcessIdentity;
  } catch {
    return undefined;
  }
}

export function listDshCandidates(layout: RuntimeLayout, platform: NodeJS.Platform = process.platform): Array<{ pid: number; ppid: number; pgid: number; command: string }> {
  if (platform === "win32") {
    return [];
  }
  let out = "";
  try {
    out = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8" });
  } catch {
    return [];
  }
  const rows: Array<{ pid: number; ppid: number; pgid: number; command: string }> = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const command = m[4] ?? "";
    if (!command.includes(layout.nodeBin) || !command.includes(layout.dshEntry)) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), command });
  }
  return rows;
}

function signalProcess(pid: number, signal: NodeJS.Signals): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

export function killIdentity(id: ProcessIdentity, signal: NodeJS.Signals): boolean {
  const platform = hostPlatform(id);
  if (platform === "win32") {
    if (id.supervisorPid && id.supervisorStartMs && id.supervisorExecutable && processStillMatches({
      ...id, pid: id.supervisorPid, startMs: id.supervisorStartMs, executable: id.supervisorExecutable,
    })) return signalProcess(id.supervisorPid, signal);
    if (!processStillMatches(id)) return false;
    return signalProcess(id.pid, signal);
  }
  if (!processStillMatches(id)) return false;
  try {
    process.kill(-id.pgid, signal);
    return true;
  } catch {
    return signalProcess(id.pid, signal);
  }
}

export function reapDshOrphans(layout: RuntimeLayout, keep?: ProcessIdentity, user?: UserLayout): Array<{ pid: number; ppid: number }> {
  // Executable identity alone cannot distinguish two Penglai data roots.
  // Windows children are owned through their recorded Job supervisor identity.
  if ((keep?.platform ?? process.platform) === "win32" || !user) return [];
  let expectedCwd: string;
  try { expectedCwd = realpathSync(user.dshHome); } catch { return []; }
  const killed: Array<{ pid: number; ppid: number }> = [];
  for (const row of listDshCandidates(layout, "darwin")) {
    if (keep && row.pid === keep.pid) continue;
    try {
      const cwd = execFileSync("/usr/sbin/lsof", ["-a", "-p", String(row.pid), "-d", "cwd", "-Fn"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        .split("\n").find((line) => line.startsWith("n"))?.slice(1);
      if (!cwd || realpathSync(cwd) !== expectedCwd) continue;
      process.kill(row.pid, "SIGKILL");
      killed.push({ pid: row.pid, ppid: row.ppid });
    } catch { /* unverified or already gone: never signal another instance */ }
  }
  return killed;
}

export function migrateUserSchema(user: UserLayout): { from: number; to: number } {
  const p = join(user.root, "schema.json");
  let from = 0;
  if (existsSync(p)) {
    try {
      from = Number((JSON.parse(readFileSync(p, "utf8")) as { version?: number }).version ?? 0);
    } catch {
      from = 0;
    }
  }
  writeFileAtomic(p, JSON.stringify({ version: USER_SCHEMA, product: "0.5.0" }, null, 2), 0o600);
  return { from, to: USER_SCHEMA };
}

export function leftoverDsh(layout: RuntimeLayout): Array<{ pid: number; ppid: number; pgid: number; command: string }> {
  return listDshCandidates(layout);
}

export function clearIdentity(user: UserLayout): void {
  rmSync(identityPath(user), { force: true });
}
