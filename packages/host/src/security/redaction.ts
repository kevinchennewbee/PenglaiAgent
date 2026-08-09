import * as os from "node:os";
import * as path from "node:path";

export interface RedactionResult {
  text: string;
  redactions: number;
}

function redactPemPrivateKeys(input: string): RedactionResult {
  const begin = "-----BEGIN ";
  let cursor = 0;
  let text = "";
  let redactions = 0;
  while (cursor < input.length) {
    const start = input.indexOf(begin, cursor);
    if (start < 0) {
      text += input.slice(cursor);
      break;
    }
    const headerEnd = input.indexOf("-----", start + begin.length);
    if (headerEnd < 0) {
      text += input.slice(cursor);
      break;
    }
    const label = input.slice(start + begin.length, headerEnd);
    if (
      label.length > 64 ||
      !label.endsWith("PRIVATE KEY") ||
      [...label].some((character) => character !== " " && (character < "A" || character > "Z"))
    ) {
      text += input.slice(cursor, start + begin.length);
      cursor = start + begin.length;
      continue;
    }
    const endMarker = `-----END ${label}-----`;
    const end = input.indexOf(endMarker, headerEnd + 5);
    if (end < 0) {
      text += input.slice(cursor);
      break;
    }
    text += `${input.slice(cursor, start)}[REDACTED PRIVATE KEY]`;
    cursor = end + endMarker.length;
    redactions += 1;
  }
  return { text, redactions };
}

function isSensitiveAssignmentKey(prefix: string): boolean {
  const separator = Math.min(
    ...[prefix.indexOf("="), prefix.indexOf(":")].filter((index) => index >= 0),
  );
  const normalized = prefix
    .slice(0, separator)
    .trim()
    .toLowerCase()
    .replaceAll("_", "")
    .replaceAll("-", "");
  return [
    "apikey", "accesstoken", "refreshtoken", "authtoken", "password",
    "passwd", "secret", "privatekey",
  ].some((marker) => normalized === marker || normalized.endsWith(marker));
}

/** Best-effort defense against credentials being persisted in logs/evidence. */
export function redactSensitiveText(input: string, homeDir = os.homedir()): RedactionResult {
  const pem = redactPemPrivateKeys(input);
  let text = pem.text;
  let redactions = pem.redactions;
  const apply = (pattern: RegExp, replacement: string | ((...args: string[]) => string)): void => {
    text = text.replace(pattern, (...args: string[]) => {
      redactions += 1;
      return typeof replacement === "string" ? replacement : replacement(...args);
    });
  };

  apply(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, (_m, prefix) => `${prefix}[REDACTED]`);
  apply(/((?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+)[^\s'";,]+/gi, (_m, prefix) => `${prefix}[REDACTED]`);
  apply(/("(?:apiKey|accessToken|refreshToken|authToken|token|password|secret|privateKey)"\s*:\s*")[^"]*(")/gi, (_m, prefix, suffix) => `${prefix}[REDACTED]${suffix}`);
  text = text.replace(
    /(\b[A-Za-z_][A-Za-z0-9_-]{0,127}\s*[=:]\s*)('[^'\r\n]*'|"[^"\r\n]*"|[^\s,;\r\n]+)/g,
    (match, prefix: string) => {
      if (!isSensitiveAssignmentKey(prefix)) return match;
      redactions += 1;
      return `${prefix}[REDACTED]`;
    },
  );
  apply(/(--(?:api-key|token|password|secret)(?:=|\s+))('[^']*'|"[^"]*"|[^\s]+)/gi, (_m, prefix) => `${prefix}[REDACTED]`);
  apply(/([?&](?:access_token|api_key|apikey|token|key|secret|password)=)[^&#\s]+/gi, (_m, prefix) => `${prefix}[REDACTED]`);
  apply(/\b(?:sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16})\b/g, "[REDACTED TOKEN]");

  if (homeDir && homeDir !== path.parse(homeDir).root) {
    const escaped = homeDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    apply(new RegExp(escaped, "g"), "[HOME]");
  }
  return { text, redactions };
}

/** Recursively redact strings before writing structured audit metadata. */
export function redactSensitiveValue<T>(value: T): T {
  const seen = new WeakSet<object>();
  const walk = (current: unknown): unknown => {
    if (typeof current === "string") return redactSensitiveText(current).text;
    if (Array.isArray(current)) return current.map(walk);
    if (!current || typeof current !== "object") return current;
    if (seen.has(current)) return "[CIRCULAR]";
    seen.add(current);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current)) out[key] = walk(item);
    return out;
  };
  return walk(value) as T;
}
