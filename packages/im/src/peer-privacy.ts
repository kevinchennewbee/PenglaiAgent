import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function loadOrCreatePeerHmacKey(filePath: string): Buffer {
  try {
    const existing = readFileSync(filePath);
    if (existing.length === 32) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  writeFileSync(filePath, key, { mode: 0o600 });
  return key;
}

export function hmacPeerRef(key: Buffer, channel: string, accountRef: string, senderId: string): string {
  return createHmac("sha256", key).update(`${channel}\0${accountRef}\0${senderId}`).digest("hex");
}
