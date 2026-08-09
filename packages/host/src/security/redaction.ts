import * as os from "node:os";
import * as path from "node:path";

export interface RedactionResult {
  text: string;
  redactions: number;
}

/** Best-effort defense against credentials being persisted in logs/evidence. */
export function redactSensitiveText(input: string, homeDir = os.homedir()): RedactionResult {
  let text = input;
  let redactions = 0;
  const apply = (pattern: RegExp, replacement: string | ((...args: string[]) => string)): void => {
    text = text.replace(pattern, (...args: string[]) => {
      redactions += 1;
      return typeof replacement === "string" ? replacement : replacement(...args);
    });
  };

  apply(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]");
  apply(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, (_m, prefix) => `${prefix}[REDACTED]`);
  apply(/((?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+)[^\s'";,]+/gi, (_m, prefix) => `${prefix}[REDACTED]`);
  apply(/("(?:apiKey|accessToken|refreshToken|authToken|token|password|secret|privateKey)"\s*:\s*")[^"]*(")/gi, (_m, prefix, suffix) => `${prefix}[REDACTED]${suffix}`);
  apply(/((?:[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|AUTH[_-]?TOKEN|PASSWORD|PASSWD|SECRET|PRIVATE[_-]?KEY)[A-Z0-9_]*|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|passwd|secret|private[_-]?key)\s*[=:]\s*)('[^']*'|"[^"]*"|[^\s,;]+)/gi, (_m, prefix) => `${prefix}[REDACTED]`);
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
