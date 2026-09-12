import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

const MAX_DEPTH = 10;
const MAX_KEYS = 256;
const MAX_ARRAY = 512;
const MAX_TEXT = 16_384;
const MAX_TOTAL_BYTES = 1_048_576;
const SECRET_KEY =
  /(?:^|[_-])(?:api[_-]?key|authorization|password|secret|token)(?:$|[_-])/i;
const INLINE_SECRET =
  /(?:sk-[A-Za-z0-9_-]{10,}|github_pat_[A-Za-z0-9_]{10,}|gh[oprsu]_[A-Za-z0-9]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|\d{6,12}:[A-Za-z0-9_-]{20,}|(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{10,}|(?:api[_-]?key|client[_-]?secret|app[_-]?secret|access[_-]?token|refresh[_-]?token|bot[_-]?token|token|password)\s*[:=]\s*(?:["'][^"']{6,}["']|[^\s,;&]{8,}))/gi;
const PRIVATE_PATH =
  /(?:\/(?:Users|Volumes|home)\/[^/\s"'<>]+(?:\/[^\s"'<>]*)?|C:[\\/]+Users[\\/]+[^\\/\s"'<>]+(?:[\\/]+[^\s"'<>]*)?)/gi;
const PERSONAL_EMAIL =
  /\b(?!41898282\+github-actions\[bot\]@users\.noreply\.github\.com\b)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const DEFAULT_EVIDENCE_ROOT = resolve(
  import.meta.dirname,
  "..",
  "..",
  "evidence",
  "generated",
);

function normalizedKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

export function sanitizeEvidenceText(value, maxLength = MAX_TEXT) {
  const text = String(value)
    .replace(INLINE_SECRET, "[redacted]")
    .replace(PRIVATE_PATH, "[private-path]")
    .replace(PERSONAL_EMAIL, "[private-email]");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n[truncated ${text.length - maxLength} chars]`;
}

export function sanitizeEvidenceValue(
  value,
  depth = 0,
  seen = new WeakSet(),
  key = "",
) {
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string") {
    if (SECRET_KEY.test(normalizedKey(key))) return "[redacted]";
    return sanitizeEvidenceText(value);
  }
  if (typeof value === "bigint") return value.toString(10);
  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol"
  )
    return undefined;
  if (Buffer.isBuffer(value)) {
    return {
      type: "Buffer",
      bytes: value.length,
      sha256: createHash("sha256").update(value).digest("hex"),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: sanitizeEvidenceText(value.name, 128),
      message: sanitizeEvidenceText(value.message),
    };
  }
  if (depth >= MAX_DEPTH) return "[depth-limit]";
  if (seen.has(value)) return "[cycle]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_ARRAY)
        .map((entry) => sanitizeEvidenceValue(entry, depth + 1, seen));
    }
    const output = {};
    for (const [entryKey, entryValue] of Object.entries(value).slice(
      0,
      MAX_KEYS,
    )) {
      const sanitized = sanitizeEvidenceValue(
        entryValue,
        depth + 1,
        seen,
        entryKey,
      );
      if (sanitized !== undefined) output[entryKey] = sanitized;
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function assertConfinedEvidencePath(path, root) {
  const target = resolve(path);
  const canonicalRoot = realpathSync(resolve(root));
  const canonicalParent = realpathSync(dirname(target));
  const parentRel = relative(canonicalRoot, canonicalParent);
  const canonicalTarget = join(canonicalParent, basename(target));
  const rel = relative(canonicalRoot, canonicalTarget);
  if (
    rel === "" ||
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    parentRel.startsWith("..") ||
    isAbsolute(parentRel)
  ) {
    throw new Error("evidence JSON destination escaped its fixed output root");
  }
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error("evidence JSON refuses a symlink destination");
  }
  if (existsSync(target) && !lstatSync(target).isFile()) {
    throw new Error("evidence JSON destination must be a regular file");
  }
  return canonicalTarget;
}

function writeAll(descriptor, payload) {
  let offset = 0;
  while (offset < payload.length) {
    // The caller has bounded and recursively sanitized the record, confined the
    // canonical parent, and opened a same-directory O_EXCL file descriptor.
    // codeql[js/http-to-file-access] This is the deliberate post-sanitization trust-boundary write.
    const written = writeSync(
      descriptor,
      payload, // lgtm[js/http-to-file-access]
      offset,
      payload.length - offset,
      offset,
    );
    if (!Number.isSafeInteger(written) || written <= 0) {
      throw new Error("evidence JSON write made no progress");
    }
    offset += written;
  }
}

export function writeEvidenceJson(path, value, options = {}) {
  if (
    value === null ||
    typeof value !== "object" ||
    Buffer.isBuffer(value) ||
    ArrayBuffer.isView(value)
  ) {
    throw new Error("evidence JSON only writes local structured records");
  }
  const target = assertConfinedEvidencePath(
    path,
    options.root ?? DEFAULT_EVIDENCE_ROOT,
  );
  const payload = Buffer.from(
    `${JSON.stringify(sanitizeEvidenceValue(value), null, 2)}\n`,
  );
  const maximumBytes = options.maxBytes ?? MAX_TOTAL_BYTES;
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    payload.length > maximumBytes
  ) {
    throw new Error(`evidence JSON exceeds the ${maximumBytes} byte limit`);
  }
  const temp = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = openSync(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    );
    writeAll(descriptor, payload);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temp, target);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temp);
    } catch {
      // The temp path may not have been created, or rename may already have moved it.
    }
    throw error;
  }
}
