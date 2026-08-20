import { randomBytes } from "node:crypto";

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
