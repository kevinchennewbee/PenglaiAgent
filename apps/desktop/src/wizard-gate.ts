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
    if (rec.current !== "COMPLETE") return false;
    return onboardingFactsProveReady(join(userRoot, "onboarding"), userRoot);
  } catch {
    return false;
  }
}

function regularFile(path: string): boolean {
  try {
    const st = lstatSync(path);
    return st.isFile() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

function existingDir(path: string): boolean {
  try {
    const st = lstatSync(path);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

function credentialStillConfigured(userRoot: string, credentialRef: string): boolean {
  const yaml = join(userRoot, "dsh-home", ".credentials.yaml");
  if (!regularFile(yaml)) return false;
  const text = readFileSync(yaml, "utf8");
  const escaped = credentialRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}\\s*:\\s*\\S+`, "m").test(text);
}

export function onboardingFactsProveReady(dir: string, userRoot = join(dir, "..")): boolean {
  const path = join(dir, "onboarding-facts.json");
  if (!regularFile(path)) return false;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const selection = raw.selection as { provider?: unknown; model?: unknown } | undefined;
    const apiTest = raw.apiTest as { nonceDigest?: unknown; finalDigest?: unknown; sessionId?: unknown } | undefined;
    const first = raw.firstConversation as { sessionId?: unknown; messageDigest?: unknown; finalDigest?: unknown } | undefined;
    if (
      !(
        typeof selection?.provider === "string" &&
        selection.provider &&
        typeof selection.model === "string" &&
        selection.model &&
        typeof raw.credentialRef === "string" &&
        raw.credentialRef &&
        typeof raw.workspaceId === "string" &&
        raw.workspaceId &&
        typeof apiTest?.nonceDigest === "string" &&
        /^[0-9a-f]{64}$/.test(apiTest.nonceDigest) &&
        typeof apiTest.finalDigest === "string" &&
        /^[0-9a-f]{64}$/.test(apiTest.finalDigest) &&
        typeof apiTest.sessionId === "string" &&
        apiTest.sessionId &&
        typeof first?.sessionId === "string" &&
        first.sessionId &&
        typeof first.messageDigest === "string" &&
        /^[0-9a-f]{64}$/.test(first.messageDigest) &&
        typeof first.finalDigest === "string" &&
        /^[0-9a-f]{64}$/.test(first.finalDigest)
      )
    ) {
      return false;
    }
    if (!credentialStillConfigured(userRoot, String(raw.credentialRef))) return false;
    const workspaceDir = join(userRoot, "dsh-home", "workspaces", String(raw.workspaceId));
    if (!existingDir(workspaceDir)) return false;
    const nonceFile = join(dir, "current-nonce.digest");
    if (!regularFile(nonceFile) || readFileSync(nonceFile, "utf8").trim() !== apiTest.nonceDigest) return false;
    if (!existingDir(join(userRoot, "dsh-home", "sessions", String(apiTest.sessionId)))) return false;
    if (!existingDir(join(userRoot, "dsh-home", "sessions", String(first.sessionId)))) return false;
    return true;
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
