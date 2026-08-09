import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { openRegularFileNoFollow, readPrivateTextFile } from "./security/private-file.js";

export interface HostTokenInspection {
  ok: boolean;
  file: string;
  message: string;
  mode: number | null;
}

function tokenFilePath(dataDir: string): string {
  return path.join(path.resolve(dataDir), "host.token");
}

function assertOwnedByCurrentUser(stat: fs.Stats, file: string): void {
  if (typeof process.getuid !== "function") return;
  if (stat.uid !== process.getuid()) {
    throw new Error(`Host credential is not owned by the current user: ${file}`);
  }
}

/** Read and harden an existing Host credential. Symlinks fail closed. */
export function readAndHardenHostToken(dataDir: string): string {
  const file = tokenFilePath(dataDir);
  fs.chmodSync(path.dirname(file), 0o700);
  const token = readPrivateTextFile(file, 4096, true).text.trim();
  if (token.length < 32) throw new Error(`Host credential is empty or too short: ${file}`);
  return token;
}

/** Load an existing credential or atomically create a 192-bit one. */
export function loadOrCreateHostToken(dataDir: string): string {
  const file = tokenFilePath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  try {
    return readAndHardenHostToken(dataDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const token = crypto.randomBytes(24).toString("hex");
  let fd: number | null = null;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
        (process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0)),
      0o600,
    );
    fs.writeFileSync(fd, `${token}\n`, "utf-8");
    fs.fsyncSync(fd);
    fs.fchmodSync(fd, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return readAndHardenHostToken(dataDir);
    }
    throw error;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  return token;
}

/** Doctor-facing check. It never returns or logs token material. */
export function inspectHostTokenFile(dataDir: string): HostTokenInspection {
  const file = tokenFilePath(dataDir);
  let descriptor: number | null = null;
  try {
    const opened = openRegularFileNoFollow(file);
    descriptor = opened.descriptor;
    const stat = opened.stat;
    assertOwnedByCurrentUser(stat, file);
    const mode = stat.mode & 0o777;
    if ((mode & 0o077) !== 0) {
      return { ok: false, file, message: `Host credential permissions are ${mode.toString(8)}; expected 600`, mode };
    }
    if (fs.readFileSync(descriptor, "utf-8").trim().length < 32) {
      return { ok: false, file, message: "Host credential is empty or too short", mode };
    }
    return { ok: true, file, message: "Host credential is private (0600)", mode };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const detail = error instanceof Error ? error.message : String(error);
    if (code === "ENOENT") {
      return { ok: false, file, message: "Host credential is missing", mode: null };
    }
    if (detail.includes("symlink") || detail.includes("regular file")) {
      return { ok: false, file, message: "Host credential is not a regular file", mode: null };
    }
    if (detail.includes("not owned")) {
      return { ok: false, file, message: "Host credential has the wrong owner", mode: null };
    }
    return { ok: false, file, message: "Host credential cannot be read", mode: null };
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}
