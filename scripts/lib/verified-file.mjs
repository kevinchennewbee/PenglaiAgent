import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";

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
