import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function unchanged(left, right) {
  return (
    sameFile(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

/**
 * Read the exact regular file that was opened, without following a late symlink
 * or silently accepting an in-place mutation during the read.
 */
export function readVerifiedRegularFile(path) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    const named = lstatSync(path, { bigint: true });
    if (!before.isFile() || !named.isFile() || !sameFile(before, named)) {
      throw new Error(`${path} must resolve to the opened regular file`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (!unchanged(before, after) || BigInt(bytes.length) !== after.size) {
      throw new Error(`${path} changed while it was being read`);
    }
    return { bytes, stat: after };
  } finally {
    closeSync(descriptor);
  }
}

export function writeAllVerified(descriptor, payload, writer = writeSync) {
  let offset = 0;
  while (offset < payload.length) {
    const written = writer(descriptor, payload, offset, payload.length - offset, offset);
    if (!Number.isSafeInteger(written) || written <= 0) {
      throw new Error("verified file write made no progress");
    }
    offset += written;
  }
}

/**
 * Atomically replace an existing regular file after binding its read to one
 * identity. Writable hardlinks are refused so an update cannot mutate another
 * name; the replacement itself is a same-directory O_EXCL file.
 */
export function updateVerifiedRegularFile(path, update) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const target = resolve(path);
  const descriptor = openSync(target, constants.O_RDONLY | noFollow);
  let tempDescriptor;
  let temp;
  try {
    const before = fstatSync(descriptor, { bigint: true });
    const named = lstatSync(target, { bigint: true });
    if (!before.isFile() || !named.isFile() || !sameFile(before, named)) {
      throw new Error(`${target} must resolve to the opened regular file`);
    }
    if (before.nlink !== 1n) {
      throw new Error(`${target} must not be a writable hardlink`);
    }
    const existing = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor, { bigint: true });
    if (!unchanged(before, afterRead) || BigInt(existing.length) !== afterRead.size) {
      throw new Error(`${target} changed while it was being read`);
    }
    const replacement = Buffer.from(update(existing));
    temp = join(
      dirname(target),
      `.${basename(target)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
    );
    tempDescriptor = openSync(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      Number(before.mode & 0o777n),
    );
    writeAllVerified(tempDescriptor, replacement);
    fsyncSync(tempDescriptor);
    closeSync(tempDescriptor);
    tempDescriptor = undefined;
    const current = lstatSync(target, { bigint: true });
    const finalSource = fstatSync(descriptor, { bigint: true });
    if (!current.isFile() || !unchanged(before, current) || !unchanged(before, finalSource)) {
      throw new Error(`${target} changed before atomic replacement`);
    }
    closeSync(descriptor);
    renameSync(temp, target);
    temp = undefined;
    return;
  } finally {
    try {
      closeSync(descriptor);
    } catch {
      // Already closed before the atomic rename.
    }
    if (tempDescriptor !== undefined) closeSync(tempDescriptor);
    if (temp !== undefined) {
      try {
        unlinkSync(temp);
      } catch {
        // The temp file may not have been created.
      }
    }
  }
}
