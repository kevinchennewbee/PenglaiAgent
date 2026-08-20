import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function onboardingLedgerComplete(userRoot: string): boolean {
  const path = join(userRoot, "onboarding", "onboarding.json");
  if (!existsSync(path)) return false;
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return false;
  }
  // The ledger must be a real regular file owned by the app-private home; a
  // symlink here could be used to point at an attacker-controlled file that
  // says "COMPLETE" and skips onboarding.
  if (!st.isFile() || st.isSymbolicLink()) return false;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const rec = raw as Record<string, unknown>;
    if (rec.schema !== undefined && rec.schema !== 2) return false;
    return rec.current === "COMPLETE";
  } catch {
    return false;
  }
}

export function wizardUrlForOrigin(origin: string): string {
  return new URL("/wizard/", origin).href;
}

/** Strip secret-shaped fragments before they reach recovery DOM or logs. */
export function sanitizeStartupReason(reason: string): string {
  return reason
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]")
    .replace(/(api[_-]?key|secret|token|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 400);
}
