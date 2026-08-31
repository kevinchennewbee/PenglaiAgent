import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { PenglaiError } from "@penglai/contracts";
import {
  assertWindowsAclHonest,
  windowsCredentialAcl,
  type WindowsAclSubject,
} from "./permissions.js";
import type { DeletionInspectionOptions } from "./uninstall.js";

export interface WindowsJobObjectPlan {
  killOnJobClose: true;
  breakawayOk: false;
  assignSpawnedChildren: true;
  createSuspendedThenAssign: true;
}

export function windowsJobObjectPlan(): WindowsJobObjectPlan {
  return {
    killOnJobClose: true,
    breakawayOk: false,
    assignSpawnedChildren: true,
    createSuspendedThenAssign: true,
  };
}

export function assertWindowsJobHonest(actual: Partial<WindowsJobObjectPlan>): void {
  const expected = windowsJobObjectPlan();
  if (actual.killOnJobClose !== expected.killOnJobClose) {
    throw new PenglaiError("SECURITY_POLICY", "Windows Job Object must kill on close");
  }
  if (actual.breakawayOk) {
    throw new PenglaiError("SECURITY_POLICY", "Windows Job Object must forbid breakaway");
  }
  if (actual.assignSpawnedChildren !== true) {
    throw new PenglaiError("SECURITY_POLICY", "Windows Job Object must assign spawned children");
  }
  if (actual.createSuspendedThenAssign !== true) {
    throw new PenglaiError("SECURITY_POLICY", "Windows Job Object must create suspended then assign");
  }
}

export function refusePosixModeAsWindowsAcl(kind: "posix-mode" | "windows-acl"): void {
  if (kind === "posix-mode") {
    throw new PenglaiError("SECURITY_POLICY", "POSIX mode cannot impersonate Windows ACL");
  }
}

export interface WindowsAclApplyResult {
  applied: boolean;
  reason?: "plan-only" | "native";
  plan: ReturnType<typeof windowsCredentialAcl>;
  owner?: string;
}

export interface WindowsHostInvokeOptions {
  platform?: NodeJS.Platform;
  hostPath?: string;
  appRoot?: string;
  timeoutMs?: number;
  input?: string;
}

export function applyWindowsCredentialAcl(
  subjectsOrPath: WindowsAclSubject[] | string,
  options: WindowsHostInvokeOptions = {},
): WindowsAclApplyResult {
  if (Array.isArray(subjectsOrPath)) {
    assertWindowsAclHonest(subjectsOrPath);
    return { applied: false, reason: "plan-only", plan: windowsCredentialAcl() };
  }
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    refusePosixModeAsWindowsAcl("posix-mode");
  }
  const path = subjectsOrPath;
  if (!path || !(isAbsolute(path) || win32.isAbsolute(path))) {
    throw new PenglaiError("SECURITY_POLICY", "Windows ACL path must be absolute");
  }
  const report = invokeWindowsHost(["acl-apply", "--path", path], options);
  if (report.applied !== true || typeof report.owner !== "string" || !report.owner.startsWith("sid:")) {
    throw new PenglaiError("SECURITY_POLICY", "native Windows ACL apply did not return a SID owner");
  }
  return { applied: true, reason: "native", plan: windowsCredentialAcl(), owner: report.owner };
}

export interface WindowsNativeHostSourceFacts {
  present: boolean;
  source: string;
  createJobObject: boolean;
  killOnJobClose: boolean;
  createSuspended: boolean;
  assignProcess: boolean;
  resumeThread: boolean;
  forbidsBreakaway: boolean;
  namedSecurityInfo: boolean;
  reparseAttribute: boolean;
  jobSupervise: boolean;
  deletePlan: boolean;
  processSuspendResume: boolean;
  processReapSupervisors: boolean;
  pathBatchProbe: boolean;
  childExitMonitoring: boolean;
  ownerStopMonitoring: boolean;
  restrictedStdioForwarding: boolean;
}

export function windowsNativeHostSourcePath(): string {
  return resolve(fileURLToPath(new URL("../../../native/windows-host/penglai_windows_host.c", import.meta.url)));
}

export function windowsNativeHostSourceFacts(): WindowsNativeHostSourceFacts {
  const source = windowsNativeHostSourcePath();
  if (!existsSync(source) || lstatSync(source).isSymbolicLink() || !lstatSync(source).isFile()) {
    throw new PenglaiError("STORE_CORRUPT", "Windows native host source missing");
  }
  const text = readFileSync(source, "utf8");
  return {
    present: true,
    source,
    createJobObject: text.includes("CreateJobObjectW"),
    killOnJobClose: text.includes("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE"),
    createSuspended: text.includes("CREATE_SUSPENDED"),
    assignProcess: text.includes("AssignProcessToJobObject"),
    resumeThread: text.includes("ResumeThread"),
    forbidsBreakaway: !text.includes("JOB_OBJECT_LIMIT_BREAKAWAY_OK") ||
      text.includes("BREAKAWAY_OK and SILENT_BREAKAWAY_OK stay unset"),
    namedSecurityInfo: text.includes("SetNamedSecurityInfoW") && text.includes("GetNamedSecurityInfoW"),
    reparseAttribute: text.includes("FILE_ATTRIBUTE_REPARSE_POINT"),
    jobSupervise: text.includes("job-supervise"),
    deletePlan: text.includes("delete-plan"),
    processSuspendResume:
      text.includes("process-suspend") &&
      text.includes("process-resume") &&
      text.includes("CreateToolhelp32Snapshot") &&
      text.includes("SuspendThread"),
    processReapSupervisors:
      text.includes("process-reap-supervisors") &&
      text.includes("TH32CS_SNAPPROCESS") &&
      text.includes("TerminateProcess"),
    pathBatchProbe:
      text.includes("path-batch-probe") &&
      text.includes("probe-path-escape") &&
      text.includes("owner-mismatch"),
    childExitMonitoring:
      text.includes("WaitForMultipleObjects") &&
      text.includes("waits[0] = pi.hProcess") &&
      text.includes("childExitMonitored"),
    ownerStopMonitoring:
      text.includes("CreateThread") &&
      text.includes("wait_for_owner_stop") &&
      text.includes("ownerStopMonitored"),
    restrictedStdioForwarding:
      text.includes("PROC_THREAD_ATTRIBUTE_HANDLE_LIST") &&
      text.includes("STARTF_USESTDHANDLES") &&
      text.includes("DuplicateHandle") &&
      text.includes("stdioForwarded"),
  };
}

export function windowsNativeHostContract(): {
  posixModeImpersonation: false;
  job: WindowsJobObjectPlan;
  acl: ReturnType<typeof windowsCredentialAcl>;
} {
  return {
    posixModeImpersonation: false,
    job: windowsJobObjectPlan(),
    acl: windowsCredentialAcl(),
  };
}

export interface WindowsNativeHostStatus {
  required: boolean;
  available: boolean;
  executable?: string;
}

export function candidateWindowsHostExecutables(appRoot?: string): string[] {
  const names = ["penglai-windows-host.exe"];
  const roots: string[] = [];
  if (appRoot) roots.push(resolve(appRoot));
  roots.push(resolve(fileURLToPath(new URL("../../../native/windows-host", import.meta.url))));
  const out: string[] = [];
  for (const root of roots) {
    for (const name of names) {
      out.push(join(root, name));
      out.push(join(root, "runtime", "helpers", name));
      out.push(join(root, "helpers", name));
    }
  }
  return out;
}

export function resolveWindowsHostExecutable(appRoot?: string): string | undefined {
  for (const candidate of candidateWindowsHostExecutables(appRoot)) {
    try {
      if (existsSync(candidate) && lstatSync(candidate).isFile() && !lstatSync(candidate).isSymbolicLink()) {
        return candidate;
      }
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

export function windowsNativeHostStatus(platform: NodeJS.Platform = process.platform, appRoot?: string): WindowsNativeHostStatus {
  const required = platform === "win32";
  const executable = resolveWindowsHostExecutable(appRoot);
  return { required, available: Boolean(executable), ...(executable ? { executable } : {}) };
}

export function requireWindowsNativeHost(
  platform: NodeJS.Platform = process.platform,
  appRoot?: string,
): string {
  if (platform !== "win32") {
    throw new PenglaiError("SECURITY_POLICY", "Windows native host is not a Windows host");
  }
  const executable = resolveWindowsHostExecutable(appRoot);
  if (!executable) {
    throw new PenglaiError("SECURITY_POLICY", "native Windows host is required and unavailable");
  }
  return executable;
}

export interface WindowsHostReport {
  ok: true;
  command?: string;
  pid?: number;
  startMs?: number;
  owner?: string;
  executable?: string;
  jobAssigned?: boolean;
  killOnJobClose?: boolean;
  breakawayOk?: boolean;
  applied?: boolean;
  reparse?: boolean;
  deleted?: number;
  count?: number;
  pids?: number[];
  childExitMonitored?: boolean;
  ownerStopMonitored?: boolean;
  stdioForwarded?: boolean;
}

export function parseWindowsHostReport(raw: string): WindowsHostReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim().split("\n").filter(Boolean).at(-1) ?? "");
  } catch {
    throw new PenglaiError("STORE_CORRUPT", "native Windows host returned unreadable JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PenglaiError("STORE_CORRUPT", "native Windows host returned an invalid report");
  }
  const value = parsed as Record<string, unknown>;
  if (value.ok !== true) {
    throw new PenglaiError("SECURITY_POLICY", `native Windows host failed: ${String(value.error ?? "UNKNOWN")}`);
  }
  if (value.breakawayOk === true) {
    throw new PenglaiError("SECURITY_POLICY", "Windows Job Object must forbid breakaway");
  }
  if (value.killOnJobClose === false) {
    throw new PenglaiError("SECURITY_POLICY", "Windows Job Object must kill on close");
  }
  return {
    ok: true,
    ...(typeof value.command === "string" ? { command: value.command } : {}),
    ...(typeof value.pid === "number" && Number.isInteger(value.pid) ? { pid: value.pid } : {}),
    ...(typeof value.startMs === "number" && Number.isFinite(value.startMs) ? { startMs: value.startMs } : {}),
    ...(typeof value.owner === "string" ? { owner: value.owner } : {}),
    ...(typeof value.executable === "string" ? { executable: value.executable } : {}),
    ...(typeof value.jobAssigned === "boolean" ? { jobAssigned: value.jobAssigned } : {}),
    ...(typeof value.killOnJobClose === "boolean" ? { killOnJobClose: value.killOnJobClose } : {}),
    ...(typeof value.breakawayOk === "boolean" ? { breakawayOk: value.breakawayOk } : {}),
    ...(typeof value.applied === "boolean" ? { applied: value.applied } : {}),
    ...(typeof value.reparse === "boolean" ? { reparse: value.reparse } : {}),
    ...(typeof value.deleted === "number" ? { deleted: value.deleted } : {}),
    ...(typeof value.count === "number" && Number.isInteger(value.count) && value.count >= 0
      ? { count: value.count }
      : {}),
    ...(typeof value.childExitMonitored === "boolean"
      ? { childExitMonitored: value.childExitMonitored }
      : {}),
    ...(typeof value.ownerStopMonitored === "boolean"
      ? { ownerStopMonitored: value.ownerStopMonitored }
      : {}),
    ...(typeof value.stdioForwarded === "boolean"
      ? { stdioForwarded: value.stdioForwarded }
      : {}),
    ...(Array.isArray(value.pids) && value.pids.every((pid) => typeof pid === "number" && Number.isInteger(pid) && pid > 0)
      ? { pids: value.pids as number[] }
      : {}),
  };
}

export function invokeWindowsHost(args: string[], options: WindowsHostInvokeOptions = {}): WindowsHostReport {
  const platform = options.platform ?? process.platform;
  const host = options.hostPath ?? requireWindowsNativeHost(platform, options.appRoot);
  let stdout = "";
  try {
    stdout = execFileSync(host, args, {
      encoding: "utf8",
      input: options.input,
      timeout: options.timeoutMs ?? 8_000,
      windowsHide: true,
    });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const raw = String(err.stdout ?? err.stderr ?? err.message ?? "native-host");
    try {
      return parseWindowsHostReport(raw);
    } catch (inner) {
      if (inner instanceof PenglaiError) throw inner;
      throw new PenglaiError("SECURITY_POLICY", `native Windows host failed: ${raw.slice(0, 180)}`);
    }
  }
  return parseWindowsHostReport(stdout);
}

export function windowsOwnerProbe(path: string, options: WindowsHostInvokeOptions = {}): string {
  const report = invokeWindowsHost(["owner-probe", "--path", path], options);
  if (!report.owner || !report.owner.startsWith("sid:")) {
    throw new PenglaiError("SECURITY_POLICY", "native Windows owner probe did not return a SID");
  }
  return report.owner;
}

export function windowsReparseProbe(path: string, options: WindowsHostInvokeOptions = {}): boolean {
  const report = invokeWindowsHost(["reparse-probe", "--path", path], options);
  if (typeof report.reparse !== "boolean") {
    throw new PenglaiError("SECURITY_POLICY", "native Windows reparse probe did not return a boolean");
  }
  return report.reparse;
}

export function windowsBatchTreeProbe(
  root: string,
  paths: readonly string[],
  options: WindowsHostInvokeOptions = {},
): string {
  const resolvedRoot = resolve(root);
  if (!paths.length) throw new PenglaiError("SECURITY_POLICY", "Windows batch probe requires paths");
  const normalized = paths.map((path) => {
    const value = resolve(path);
    const rel = relative(resolvedRoot, value);
    if (rel.startsWith("..") || isAbsolute(rel) || /[\r\n\0]/.test(value)) {
      throw new PenglaiError("SECURITY_POLICY", "Windows batch probe path outside root");
    }
    return value;
  });
  if (normalized[0] !== resolvedRoot) {
    throw new PenglaiError("SECURITY_POLICY", "Windows batch probe root must be first");
  }
  const report = invokeWindowsHost(
    ["path-batch-probe", "--root", resolvedRoot],
    {
      ...options,
      input: `${normalized.join("\n")}\n`,
      timeoutMs: options.timeoutMs ?? 30_000,
    },
  );
  if (
    report.command !== "path-batch-probe" ||
    !report.owner?.startsWith("sid:") ||
    report.count !== normalized.length
  ) {
    throw new PenglaiError("SECURITY_POLICY", "native Windows batch probe returned an invalid report");
  }
  return report.owner;
}

export function deletionInspectionOptionsForPlatform(
  platform: NodeJS.Platform,
  override?: Partial<DeletionInspectionOptions> & { available?: boolean; appRoot?: string },
): DeletionInspectionOptions {
  if (platform !== "win32") return { platform, ...override };
  if (override?.ownerProbe && override.reparseProbe) {
    return { platform, ...override };
  }
  if (override?.available === false || !resolveWindowsHostExecutable(override?.appRoot)) {
    throw new PenglaiError("SECURITY_POLICY", "Windows inventory requires native owner and reparse-point probes");
  }
  return {
    platform,
    ownerProbe: (path) =>
      windowsOwnerProbe(path, { platform: "win32", ...(override?.appRoot ? { appRoot: override.appRoot } : {}) }),
    reparseProbe: (path) =>
      windowsReparseProbe(path, { platform: "win32", ...(override?.appRoot ? { appRoot: override.appRoot } : {}) }),
    batchTreeProbe: (root, paths) =>
      windowsBatchTreeProbe(root, paths, {
        platform: "win32",
        ...(override?.appRoot ? { appRoot: override.appRoot } : {}),
      }),
    ...override,
  };
}

export interface OwnedSpawnRequest {
  platform: NodeJS.Platform;
  executable: string;
  entry: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  port: number;
  cwd?: string;
  appRoot?: string;
  posixSpawn?: (request: OwnedSpawnRequest) => import("node:child_process").ChildProcess;
}

export interface OwnedSpawnResult {
  child: import("node:child_process").ChildProcess;
  identity: {
    pid: number;
    startMs: number;
    executable: string;
    dshEntry: string;
    port: number;
    startedAt: string;
    owner?: string;
    jobAssigned?: boolean;
  };
}

export function quoteWindowsCommandArg(value: string): string {
  let out = '"';
  let backslashes = 0;
  for (const char of value) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }
    if (char === '"') {
      out += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    out += "\\".repeat(backslashes) + char;
    backslashes = 0;
  }
  return out + "\\".repeat(backslashes * 2) + '"';
}

export function spawnOwnedDshProcess(request: OwnedSpawnRequest): OwnedSpawnResult {
  if (request.platform === "win32") {
    // Fail first on the native supervisor being missing (the historical
    // contract), then require the bundled absolute node.exe so the supervisor
    // never launches an arbitrary caller-supplied executable.
    const host = requireWindowsNativeHost("win32", request.appRoot);
    if (!request.appRoot) throw new PenglaiError("SECURITY_POLICY", "Windows job supervisor requires an app root");
    assertOwnedAbsoluteNode(request.appRoot, request.executable);
    const quoted = [request.executable, request.entry, ...request.args].map(quoteWindowsCommandArg).join(" ");
    const child = spawn(host, ["job-supervise", "--exe", request.executable, "--cmdline", quoted], {
      env: request.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      cwd: request.cwd,
    });
    return {
      child,
      identity: {
        pid: child.pid ?? 0,
        startMs: Date.now(),
        executable: request.executable,
        dshEntry: request.entry,
        port: request.port,
        startedAt: new Date().toISOString(),
        jobAssigned: true,
      },
    };
  }
  if (!request.posixSpawn) {
    throw new PenglaiError("SECURITY_POLICY", "POSIX owned spawn helper is required");
  }
  const child = request.posixSpawn(request);
  return {
    child,
    identity: {
      pid: child.pid ?? 0,
      startMs: Date.now(),
      executable: request.executable,
      dshEntry: request.entry,
      port: request.port,
      startedAt: new Date().toISOString(),
    },
  };
}

export function windowsHelperRelativePath(): string {
  return join("runtime", "helpers", "penglai-windows-host.exe");
}

export function assertOwnedAbsoluteHelper(appRoot: string, helper: string): void {
  const expected = resolve(appRoot, windowsHelperRelativePath());
  if (resolve(helper) !== expected) {
    throw new PenglaiError("SECURITY_POLICY", "Windows helper must be the bundled absolute helper");
  }
}

export function assertOwnedAbsoluteNode(appRoot: string, executable: string): void {
  const expected = resolve(appRoot, "runtime", "node", "node.exe");
  if (resolve(executable) !== expected) {
    throw new PenglaiError("SECURITY_POLICY", "Windows job supervisor must launch the bundled absolute node.exe");
  }
}

export function readOwnedWindowsJobReport(
  child: import("node:child_process").ChildProcess,
  timeoutMs = 8_000,
): Promise<WindowsHostReport> {
  return new Promise((resolveReport, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new PenglaiError("SECURITY_POLICY", "native Windows job supervisor did not report"));
    }, timeoutMs);
    const onData = (chunk: Buffer | string): void => {
      buf += String(chunk);
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      cleanup();
      try {
        const report = parseWindowsHostReport(line);
        if (
          !report.pid ||
          report.jobAssigned !== true ||
          report.killOnJobClose !== true ||
          report.childExitMonitored !== true ||
          report.ownerStopMonitored !== true ||
          report.stdioForwarded !== true
        ) {
          reject(new PenglaiError("SECURITY_POLICY", "native Windows job supervisor report incomplete"));
          return;
        }
        resolveReport(report);
      } catch (error) {
        reject(error);
      }
    };
    const onExit = (): void => {
      cleanup();
      reject(new PenglaiError("SECURITY_POLICY", "native Windows job supervisor exited before report"));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout?.on("data", onData);
    child.once("exit", onExit);
    if (!child.stdout) {
      cleanup();
      reject(new PenglaiError("SECURITY_POLICY", "native Windows job supervisor has no stdout"));
    }
  });
}
