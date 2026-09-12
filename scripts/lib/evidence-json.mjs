import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const MAX_DEPTH = 10;
const MAX_KEYS = 256;
const MAX_ARRAY = 512;
const MAX_TEXT = 16_384;
const SECRET_KEY = /(?:^|[_-])(?:api[_-]?key|authorization|password|secret|token)(?:$|[_-])/i;
const INLINE_SECRET = /(?:sk-[A-Za-z0-9_-]{10,}|github_pat_[A-Za-z0-9_]{10,}|gh[oprsu]_[A-Za-z0-9]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|\d{6,12}:[A-Za-z0-9_-]{20,}|(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{10,}|(?:api[_-]?key|client[_-]?secret|app[_-]?secret|access[_-]?token|refresh[_-]?token|bot[_-]?token|token|password)\s*[:=]\s*(?:["'][^"']{6,}["']|[^\s,;&]{8,}))/gi;
const PRIVATE_PATH = /(?:\/Users\/[^/\s"'<>]+\/[^\s"'<>]*|\/Volumes\/[^/\s"'<>]+\/[^\s"'<>]*|C:\\Users\\[^\\\s"'<>]+\\[^\s"'<>]*)/gi;
const PERSONAL_EMAIL = /\b(?!41898282\+github-actions\[bot\]@users\.noreply\.github\.com\b)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const DEFAULT_EVIDENCE_ROOT = resolve(import.meta.dirname, "..", "..", "evidence", "generated");

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

export function sanitizeEvidenceValue(value, depth = 0, seen = new WeakSet(), key = "") {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (SECRET_KEY.test(normalizedKey(key))) return "[redacted]";
    return sanitizeEvidenceText(value);
  }
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return undefined;
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
      return value.slice(0, MAX_ARRAY).map((entry) => sanitizeEvidenceValue(entry, depth + 1, seen));
    }
    const output = {};
    for (const [entryKey, entryValue] of Object.entries(value).slice(0, MAX_KEYS)) {
      const sanitized = sanitizeEvidenceValue(entryValue, depth + 1, seen, entryKey);
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
  return canonicalTarget;
}

export function writeEvidenceJson(path, value, options = {}) {
  if (value === null || typeof value !== "object" || Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    throw new Error("evidence JSON only writes local structured records");
  }
  const target = assertConfinedEvidencePath(path, options.root ?? DEFAULT_EVIDENCE_ROOT);
  const payload = `${JSON.stringify(sanitizeEvidenceValue(value), null, 2)}\n`;
  // Browser observations are persisted only after bounded recursive redaction and
  // only inside the fixed evidence root; raw HTTP bodies and byte views are rejected.
  // codeql[js/http-to-file-access]
  writeFileSync(target, payload, { mode: 0o600 });
}
