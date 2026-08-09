import * as fs from "node:fs";
import * as path from "node:path";

/** Read-only validation. It never creates paths or changes permissions. */
export function validatePrivateDirectory(directory: string): fs.Stats {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Private data directory must be a regular directory: ${directory}`);
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error(`Private data directory is not owned by the current user: ${directory}`);
  }
  return stat;
}

export function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  validatePrivateDirectory(directory);
  fs.chmodSync(directory, 0o700);
}

/** Read-only validation for a bounded, current-user credential/config file. */
export function validatePrivateFile(file: string, maxBytes: number): fs.Stats {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Private config must be a regular file, not a symlink: ${file}`);
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error(`Private config is not owned by the current user: ${file}`);
  }
  if (stat.size > maxBytes) {
    throw new Error(`Private config exceeds ${maxBytes} bytes: ${file}`);
  }
  return stat;
}

/** Validate and harden a current-user credential/config file before use. */
export function hardenPrivateFile(file: string, maxBytes: number): fs.Stats {
  const stat = validatePrivateFile(file, maxBytes);
  fs.chmodSync(file, 0o600);
  return stat;
}

/** Atomic, exclusive temporary write for local secret-bearing JSON. */
export function atomicWritePrivateJson(file: string, value: unknown, maxBytes: number): void {
  const directory = path.dirname(file);
  ensurePrivateDirectory(directory);
  if (fs.existsSync(file)) hardenPrivateFile(file, maxBytes);
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf-8") > maxBytes) {
    throw new Error(`Private config exceeds ${maxBytes} bytes: ${file}`);
  }
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(tmp, "wx", 0o600);
    fs.writeFileSync(descriptor, payload, "utf-8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    fs.rmSync(tmp, { force: true });
  }
}

/** Append one durable line to a private regular file. */
export function appendPrivateLine(file: string, line: string): void {
  ensurePrivateDirectory(path.dirname(file));
  if (fs.existsSync(file)) hardenPrivateFile(file, Number.MAX_SAFE_INTEGER);
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(file, "a", 0o600);
    fs.writeFileSync(descriptor, line.endsWith("\n") ? line : `${line}\n`, "utf-8");
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
  fs.chmodSync(file, 0o600);
}
