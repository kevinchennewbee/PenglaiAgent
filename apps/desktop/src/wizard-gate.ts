import { join } from "node:path";
import { readExactRegularFile } from "@penglai/contracts";

const COMPLETION_STEPS = [
  "welcome-v1",
  "appearance-locale-v1",
  "privacy-v1",
  "model-provider-v1",
  "credential-v1",
  "model-test-v1",
  "workspace-v1",
  "first-turn-v1",
] as const;

export function onboardingLedgerComplete(userRoot: string): boolean {
  const path = join(userRoot, "onboarding", "onboarding.json");
  try {
    const bytes = readExactRegularFile(path, 256 * 1024);
    const raw = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const rec = raw as Record<string, unknown>;
    if (rec.schema !== 2) return false;
    if (rec.current !== "COMPLETE") return false;
    if (!Array.isArray(rec.completed)) return false;
    const completed = rec.completed;
    if (!COMPLETION_STEPS.every((step) => completed.includes(step))) return false;
    return onboardingCompletionReceiptValid(join(userRoot, "onboarding"));
  } catch {
    return false;
  }
}

/**
 * Validate the durable receipt produced by the evidence-gated first run.
 *
 * API, Workspace and first-Turn evidence is verified when each step advances.
 * Requiring those mutable external records to remain present on every later
 * launch would turn normal key rotation, session retention or Workspace moves
 * into an onboarding loop. The receipt is therefore a boot UX decision, not a
 * permission boundary; sensitive operations keep their own live checks.
 */
export function onboardingCompletionReceiptValid(dir: string): boolean {
  const path = join(dir, "onboarding-facts.json");
  try {
    const bytes = readExactRegularFile(path, 256 * 1024);
    const raw = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
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
