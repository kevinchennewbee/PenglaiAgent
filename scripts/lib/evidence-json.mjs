import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const MAX_DEPTH = 10;
const MAX_KEYS = 256;
const MAX_ARRAY = 512;
const MAX_TEXT = 16_384;
const SECRET_KEY = /(?:^|[_-])(?:api[_-]?key|authorization|password|secret|token)(?:$|[_-])/i;
const INLINE_SECRET = /(?:sk-[A-Za-z0-9_-]{10,}|github_pat_[A-Za-z0-9_]{10,}|gh[oprsu]_[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._~+/=-]{10,})/gi;

function normalizedKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

export function sanitizeEvidenceText(value, maxLength = MAX_TEXT) {
  const text = String(value).replace(INLINE_SECRET, "[redacted]");
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

export function writeEvidenceJson(path, value) {
  const payload = `${JSON.stringify(sanitizeEvidenceValue(value), null, 2)}\n`;
  writeFileSync(path, payload, { mode: 0o600 });
}
