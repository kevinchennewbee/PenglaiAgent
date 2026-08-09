/**
 * Doctor (M4)
 *
 * A self-diagnostic that checks the host's runtime prerequisites and reports
 * what's ok / warn / fail, with a suggested fix command for each problem.
 *
 * Intended to be runnable both programmatically (`runDoctor()`) and from the
 * CLI (a future `penglai host doctor` subcommand). It must never throw: every
 * check returns a DoctorResult so a partial environment still yields a full
 * report.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as net from "node:net";
import { execSync } from "node:child_process";
import { conversationsBaseDir } from "./conversation-store.js";
import { penglaiDataDir } from "./data-dir.js";
import { inspectHostTokenFile } from "./token-file.js";
import { probeVoice } from "./voice/engine.js";
import { loadPersistedProfiles } from "./profiles-store.js";

// ── public types ───────────────────────────────────────────────

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorResult {
  /** Short, machine-readable check name (e.g. "node", "npm", "host-port"). */
  check: string;
  status: DoctorStatus;
  /** Human-readable explanation of the current state. */
  message: string;
  /** Suggested command or action to move warn/fail -> ok. */
  fix?: string;
}

export interface DoctorOptions {
  /** Port to probe for host availability. Default 14169. */
  port?: number;
}

// ── constants ──────────────────────────────────────────────────

const DEFAULT_PORT = 14169;
const MIN_NODE_MAJOR = 22;

/** Model API-key env vars, in profile-catalog order. */
const MODEL_KEY_ENVS = ["GROK_API_KEY", "DEEPSEEK_API_KEY", "ZAI_API_KEY", "OPENAI_API_KEY"];

// ── helpers ────────────────────────────────────────────────────

/**
 * Run a command and return true if it exits 0. `execSync` runs through the
 * platform shell by default, so Windows resolves `npm` / `python` / `git`
 * shims (npm.cmd, etc.) via PATHEXT without an explicit `shell` option.
 * Never throws.
 */
function commandAvailable(command: string): boolean {
  try {
    execSync(command, { stdio: "ignore", timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

/** Run a command and return its trimmed stdout (empty string on failure). */
function commandOutput(command: string): string {
  try {
    const out = execSync(command, { stdio: "pipe", timeout: 8000, encoding: "utf-8" });
    return (out ?? "").trim();
  } catch {
    return "";
  }
}

/** True if a TCP port can be bound on 127.0.0.1 (i.e. is free right now). */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        srv.close();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    srv.once("error", () => done(false));
    srv.listen(port, "127.0.0.1", () => done(true));
  });
}

/** Major version number from a "v24.18.0" style string, or null. */
function nodeMajor(version: string): number | null {
  const m = /^v?(\d+)/.exec(version);
  return m ? Number(m[1]) : null;
}

// ── individual checks (each returns a DoctorResult, never throws) ──

function checkNode(): DoctorResult {
  const version = process.versions.node;
  const major = nodeMajor(version);
  if (major !== null && major >= MIN_NODE_MAJOR) {
    return { check: "node", status: "ok", message: `Node.js v${version}` };
  }
  return {
    check: "node",
    status: "fail",
    message: `Node.js v${version} found; Penglai 0.4 requires >= v${MIN_NODE_MAJOR}.`,
    fix: `install Node.js >= ${MIN_NODE_MAJOR} (https://nodejs.org/)`,
  };
}

function checkNpm(): DoctorResult {
  if (process.env.PENGLAI_DESKTOP_MANAGED === "1") {
    return { check: "npm", status: "ok", message: "Desktop 自带运行时；日常使用不需要系统 npm。" };
  }
  const v = commandOutput("npm -v");
  if (v) return { check: "npm", status: "ok", message: `npm v${v}` };
  return {
    check: "npm",
    status: "warn",
    message: "npm not found on PATH.",
    fix: "npm ships with Node.js; reinstall Node.js or add npm to PATH.",
  };
}

async function checkHostPort(port: number): Promise<DoctorResult> {
  const free = await isPortAvailable(port);
  if (free) {
    return { check: "host-port", status: "ok", message: `port ${port} is free` };
  }
  return {
    check: "host-port",
    status: "warn",
    message: `port ${port} is already in use (a Host may already be running).`,
    fix: `stop the other process on :${port}, or start the host with a different port (npm run serve -- --port <port>)`,
  };
}

function checkTokenFile(): DoctorResult {
  const inspected = inspectHostTokenFile(penglaiDataDir());
  if (inspected.ok) {
    return { check: "token", status: "ok", message: `${inspected.message} (${inspected.file})` };
  }
  return {
    check: "token",
    status: "warn",
    message: `${inspected.message} (${inspected.file}).`,
    fix: inspected.mode === null
      ? "run `npm run serve` once; the Host auto-creates the token."
      : "stop Penglai, ensure host.token is a current-user regular file, then run `chmod 600 ~/.penglai/host.token`.",
  };
}

function checkConversationsDir(): DoctorResult {
  const dir = conversationsBaseDir();
  if (fs.existsSync(dir)) {
    return { check: "conversations-dir", status: "ok", message: `conversation directory present (${dir})` };
  }
  return {
    check: "conversations-dir",
    status: "warn",
    message: `conversation directory not found at ${dir}.`,
    fix: "it is auto-created on the first conversation; no action required.",
  };
}

function checkModelProfile(): DoctorResult {
  const configured = MODEL_KEY_ENVS.filter((env) => !!process.env[env]);
  let persisted = 0;
  try {
    persisted = loadPersistedProfiles(penglaiDataDir()).filter(
      (profile) => !!profile.apiKey || !!profile.apiKeyEnv,
    ).length;
  } catch {
    // The dedicated private-file Doctor/security checks surface an unsafe file.
  }
  if (configured.length > 0 || persisted > 0) {
    return {
      check: "model-profile",
      status: "ok",
      message: configured.length > 0
        ? `at least one model API key configured (${configured.join(", ")}).`
        : `${persisted} persisted model profile(s) configured.`,
    };
  }
  return {
    check: "model-profile",
    status: "warn",
    message: "no model API key env var is set; the default profiles have no key.",
    fix: `set one of ${MODEL_KEY_ENVS.join(" / ")}`,
  };
}

function checkPython(): DoctorResult {
  if (process.env.PENGLAI_DESKTOP_MANAGED === "1") {
    return { check: "python", status: "ok", message: "0.4 Desktop 核心为 TypeScript；日常使用不需要系统 Python。" };
  }
  // `python` first (Windows / many distros), then `python3` (most Linux/macOS).
  const py = commandOutput("python --version") || commandOutput("python3 --version");
  if (py) return { check: "python", status: "ok", message: py };
  return {
    check: "python",
    status: "warn",
    message: "Python not found on PATH (needed for sidecar tools / IM bridge).",
    fix: "install Python 3 (https://www.python.org/downloads/)",
  };
}

function checkGit(): DoctorResult {
  const v = commandOutput("git --version");
  if (v) return { check: "git", status: "ok", message: v };
  return {
    check: "git",
    status: "warn",
    message: "git not found on PATH.",
    fix: "install git (https://git-scm.com/downloads)",
  };
}

/**
 * 语音能力探测（design §7：统一会话本地 ASR+TTS）。懒加载 + 组件级探测，
 * 缺东西只报 warn（语音是可选 I/O 层，绝不是 host 启动硬依赖）。
 */
function checkVoice(): DoctorResult[] {
  const probe = probeVoice(penglaiDataDir());
  const rows: DoctorResult[] = [];
  for (const cap of [probe.asr, probe.tts]) {
    const check = cap.name === "asr" ? "voice-asr" : "voice-tts";
    if (cap.ready) {
      rows.push({ check, status: "ok", message: cap.detail });
    } else {
      rows.push({
        check,
        status: "warn",
        message: cap.detail,
        fix:
          cap.name === "asr"
            ? "penglai voice setup（下载 SenseVoice，约 230MB；brew install ffmpeg）"
            : "penglai voice setup --tts（下载 MOSS-TTS-Nano，约 728MB）",
      });
    }
  }
  return rows;
}

// ── entry point ────────────────────────────────────────────────

/**
 * Run all doctor checks and return the results. Runs sequentially so a port
 * probe is fully released before the next check and output stays ordered.
 * Never throws: every check is guarded.
 */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult[]> {
  const port = options.port ?? DEFAULT_PORT;
  const results: DoctorResult[] = [];

  const checks: Array<() => DoctorResult | Promise<DoctorResult>> = [
    checkNode,
    checkNpm,
    () => checkHostPort(port),
    checkTokenFile,
    checkConversationsDir,
    checkModelProfile,
    checkPython,
    checkGit,
  ];

  for (const check of checks) {
    try {
      results.push(await check());
    } catch (e) {
      // Defensive: a check that throws should still produce a row.
      results.push({
        check: "unknown",
        status: "fail",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  // 语音探测（可选能力，懒加载；自身绝不抛，防御式包裹）。
  try {
    results.push(...checkVoice());
  } catch (e) {
    results.push({
      check: "voice",
      status: "warn",
      message: `voice probe failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  return results;
}
