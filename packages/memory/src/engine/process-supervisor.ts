import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { PenglaiError } from "@penglai/contracts";

export interface SupervisorHealth {
  binaryPresent: boolean;
  running: boolean;
  pid?: number;
  version?: string;
  degraded: boolean;
  reason?: string;
}

export class MnemonProcessSupervisor {
  private child: ChildProcess | undefined;
  private restarts = 0;
  private degraded = false;
  private reason: string | undefined;

  constructor(private readonly binaryPath: string | undefined) {}

  health(): SupervisorHealth {
    const binaryPresent = Boolean(this.binaryPath && existsSync(this.binaryPath));
    return {
      binaryPresent,
      running: Boolean(this.child && this.child.exitCode === null),
      ...(this.child?.pid ? { pid: this.child.pid } : {}),
      degraded: this.degraded || !binaryPresent,
      ...(this.reason ? { reason: this.reason } : {}),
      ...(!binaryPresent ? { reason: "mnemon binary not packaged for this target" } : {}),
    };
  }

  async probeVersion(): Promise<string | undefined> {
    if (!this.binaryPath || !existsSync(this.binaryPath)) return undefined;
    return await new Promise((resolve) => {
      const proc = spawn(this.binaryPath!, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      proc.stdout?.on("data", (chunk) => {
        out += String(chunk);
      });
      proc.on("error", () => resolve(undefined));
      proc.on("close", () => resolve(out.trim() || "mnemon"));
    });
  }

  markCrash(error: string): void {
    this.restarts += 1;
    if (this.restarts >= 3) {
      this.degraded = true;
      this.reason = `engine crash degraded: ${error}`;
    }
  }

  async drainAndStop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise<void>((resolveStop) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolveStop();
      }, 1000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolveStop();
      });
    });
  }

  assertWritable(): void {
    if (this.degraded) {
      throw new PenglaiError("DSH_UNAVAILABLE", this.reason ?? "memory engine degraded");
    }
  }

  resourceSnapshot(): { workers: number; sockets: number; timers: number } {
    return {
      workers: this.child && this.child.exitCode === null ? 1 : 0,
      sockets: 0,
      timers: 0,
    };
  }
}
