import * as fs from "node:fs";
import * as path from "node:path";

const NO_FOLLOW = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0);

export interface OpenedRegularFile {
  descriptor: number;
  stat: fs.Stats;
}

/** Open one stable regular-file handle and reject final-component symlinks. */
export function openRegularFileNoFollow(
  file: string,
  flags = fs.constants.O_RDONLY,
  mode = 0o600,
): OpenedRegularFile {
  let descriptor: number;
  try {
    descriptor = fs.openSync(file, flags | NO_FOLLOW, mode);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new Error(`Expected a stable regular file, not a symlink: ${file}`);
    }
    throw error;
  }
  try {
    const stat = fs.fstatSync(descriptor);
    const pathStat = fs.lstatSync(file);
    if (
      !stat.isFile() ||
      pathStat.isSymbolicLink() ||
      !pathStat.isFile() ||
      stat.dev !== pathStat.dev ||
      stat.ino !== pathStat.ino
    ) {
      throw new Error(`Expected a stable regular file, not a symlink: ${file}`);
    }
    return { descriptor, stat };
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

function assertPrivateStat(stat: fs.Stats, file: string, maxBytes: number): void {
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error(`Private config is not owned by the current user: ${file}`);
  }
  if (stat.size > maxBytes) {
    throw new Error(`Private config exceeds ${maxBytes} bytes: ${file}`);
  }
}

/** Read private text through the validated descriptor, never through the path. */
export function readPrivateTextFile(
  file: string,
  maxBytes: number,
  harden = false,
): { text: string; stat: fs.Stats } {
  const opened = openRegularFileNoFollow(file);
  try {
    assertPrivateStat(opened.stat, file, maxBytes);
    if (harden) fs.fchmodSync(opened.descriptor, 0o600);
    return { text: fs.readFileSync(opened.descriptor, "utf-8"), stat: opened.stat };
  } finally {
    fs.closeSync(opened.descriptor);
  }
}

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
  const opened = openRegularFileNoFollow(file);
  try {
    assertPrivateStat(opened.stat, file, maxBytes);
    fs.fchmodSync(opened.descriptor, 0o600);
    return opened.stat;
  } finally {
    fs.closeSync(opened.descriptor);
  }
}

/** Atomic, exclusive temporary write for local secret-bearing JSON. */
export function atomicWritePrivateJson(file: string, value: unknown, maxBytes: number): void {
  const directory = path.dirname(file);
  ensurePrivateDirectory(directory);
  try {
    validatePrivateFile(file, maxBytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
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
    fs.fchmodSync(descriptor, 0o600);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tmp, file);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    fs.rmSync(tmp, { force: true });
  }
}

/** Append one durable line to a private regular file. */
export function appendPrivateLine(file: string, line: string): void {
  ensurePrivateDirectory(path.dirname(file));
  let descriptor: number | null = null;
  try {
    const opened = openRegularFileNoFollow(
      file,
      fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT,
      0o600,
    );
    descriptor = opened.descriptor;
    assertPrivateStat(opened.stat, file, Number.MAX_SAFE_INTEGER);
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, line.endsWith("\n") ? line : `${line}\n`, "utf-8");
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}
