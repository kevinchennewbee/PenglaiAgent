import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { PenglaiError } from "@penglai/contracts";

const WRITE_COMMANDS = new Set(["remember", "forget", "link", "import", "store"]);
const READ_COMMANDS = new Set(["search", "recall", "related", "status", "viz", "receipt", "log"]);
const ALLOWED_COMMANDS = new Set([...WRITE_COMMANDS, ...READ_COMMANDS]);
const ALLOWED_FLAGS = new Set([
  "--cat",
  "--tags",
  "--source",
  "--imp",
  "--entities",
  "--entity-mode",
  "--no-diff",
  "--limit",
  "--basic",
  "--intent",
  "--verbose",
  "--depth",
  "--edge",
  "--format",
  "--output",
  "-o",
  "--type",
  "--weight",
  "--meta",
  "--dry-run",
]);

export interface MnemonRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class MnemonRunner {
  constructor(
    private readonly binaryPath: string,
    private readonly readonly = false,
    private readonly allowTestScriptWrapper = false,
  ) {
    if (!binaryPath || binaryPath.includes("..") || !existsSync(binaryPath)) {
      throw new PenglaiError("DSH_UNAVAILABLE", "mnemon binary missing");
    }
  }

  async run(input: {
    command: string;
    dataDir: string;
    positionals?: string[];
    flags?: Record<string, string | number | boolean>;
    timeoutMs?: number;
  }): Promise<MnemonRunResult> {
    if (!ALLOWED_COMMANDS.has(input.command)) {
      throw new PenglaiError("SECURITY_POLICY", "mnemon command not allowed");
    }
    if (this.readonly && WRITE_COMMANDS.has(input.command)) {
      throw new PenglaiError("SECURITY_POLICY", "memory store is read-only");
    }
    if (!input.dataDir || input.dataDir.includes("\0")) {
      throw new PenglaiError("SECURITY_POLICY", "mnemon data dir invalid");
    }
    const args: string[] = ["--data-dir", input.dataDir, input.command];
    for (const [flag, value] of Object.entries(input.flags ?? {})) {
      if (!ALLOWED_FLAGS.has(flag)) throw new PenglaiError("SECURITY_POLICY", `mnemon flag not allowed ${flag}`);
      if (value === true) args.push(flag);
      else if (value !== false) args.push(flag, String(value));
    }
    for (const positional of input.positionals ?? []) {
      if (positional.startsWith("-")) throw new PenglaiError("SECURITY_POLICY", "mnemon positional looks like a flag");
      args.push(positional);
    }
    return await new Promise((resolve, reject) => {
      const wrapped = this.allowTestScriptWrapper && process.platform === "win32" && this.binaryPath.endsWith(".js");
      const child = spawn(wrapped ? process.execPath : this.binaryPath, wrapped ? [this.binaryPath, ...args] : args, {
        env: {
          PATH: "/usr/bin:/bin",
          LANG: process.env.LANG ?? "C",
          TMPDIR: tmpdir(),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new PenglaiError("DSH_UNAVAILABLE", "mnemon timed out"));
      }, input.timeoutMs ?? 15000);
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
        if (stdout.length > 1_000_000) child.kill("SIGKILL");
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
        if (stderr.length > 200_000) child.kill("SIGKILL");
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? (signal ? 1 : 0) });
      });
    });
  }

  async version(): Promise<string> {
    const result = await new Promise<MnemonRunResult>((resolve, reject) => {
      const wrapped = this.allowTestScriptWrapper && process.platform === "win32" && this.binaryPath.endsWith(".js");
      const child = spawn(wrapped ? process.execPath : this.binaryPath, wrapped ? [this.binaryPath, "--version"] : ["--version"], {
        env: { PATH: "/usr/bin:/bin", LANG: process.env.LANG ?? "C", TMPDIR: tmpdir() },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    });
    if (result.exitCode !== 0 || !result.stdout.includes("0.2.4")) {
      throw new PenglaiError("DSH_UNAVAILABLE", "mnemon --version is not 0.2.4");
    }
    return result.stdout.trim();
  }
}
