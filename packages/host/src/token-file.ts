import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

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
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Host credential must be a regular file, not a symlink: ${file}`);
  }
  assertOwnedByCurrentUser(stat, file);
  fs.chmodSync(path.dirname(file), 0o700);
  fs.chmodSync(file, 0o600);
  const token = fs.readFileSync(file, "utf-8").trim();
  if (token.length < 32) throw new Error(`Host credential is empty or too short: ${file}`);
  return token;
}

/** Load an existing credential or atomically create a 192-bit one. */
export function loadOrCreateHostToken(dataDir: string): string {
  const file = tokenFilePath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  if (fs.existsSync(file)) return readAndHardenHostToken(dataDir);

  const token = crypto.randomBytes(24).toString("hex");
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "wx", 0o600);
    fs.writeFileSync(fd, `${token}\n`, "utf-8");
    fs.fsyncSync(fd);
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  fs.chmodSync(file, 0o600);
  return token;
}

/** Doctor-facing check. It never returns or logs token material. */
export function inspectHostTokenFile(dataDir: string): HostTokenInspection {
  const file = tokenFilePath(dataDir);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return { ok: false, file, message: "Host credential is missing", mode: null };
  }
  const mode = stat.mode & 0o777;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { ok: false, file, message: "Host credential is not a regular file", mode };
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    return { ok: false, file, message: "Host credential has the wrong owner", mode };
  }
  if ((mode & 0o077) !== 0) {
    return { ok: false, file, message: `Host credential permissions are ${mode.toString(8)}; expected 600`, mode };
  }
  try {
    if (fs.readFileSync(file, "utf-8").trim().length < 32) {
      return { ok: false, file, message: "Host credential is empty or too short", mode };
    }
  } catch {
    return { ok: false, file, message: "Host credential cannot be read", mode };
  }
  return { ok: true, file, message: "Host credential is private (0600)", mode };
}
