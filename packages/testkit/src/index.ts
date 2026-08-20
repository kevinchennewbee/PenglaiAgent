import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class VirtualClock {
  nowMs = 1_700_000_000_000;
  now(): number {
    return this.nowMs;
  }
  iso(): string {
    return new Date(this.nowMs).toISOString();
  }
  advance(ms: number): void {
    this.nowMs += ms;
  }
}

export class SeqIds {
  n = 0;
  id(prefix: string): string {
    this.n += 1;
    return `${prefix}_${String(this.n).padStart(6, "0")}`;
  }
  token(): string {
    this.n += 1;
    return randomBytes(16).toString("hex");
  }
}

export const SystemClock = {
  now(): number {
    return Date.now();
  },
  iso(): string {
    return new Date().toISOString();
  },
};

export class CryptoIds {
  id(prefix: string): string {
    return `${prefix}_${randomBytes(12).toString("hex")}`;
  }
  token(): string {
    return randomBytes(16).toString("hex");
  }
}

export function tmpDb(prefix = "penglai"): string {
  return join(mkdtempSync(join(tmpdir(), `${prefix}-`)), "state.sqlite");
}
