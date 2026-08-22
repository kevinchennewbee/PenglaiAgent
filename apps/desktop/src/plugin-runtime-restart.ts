import { PenglaiError } from "@penglai/contracts";

export interface PendingPluginRuntimeRestart {
  id: string;
  version: string;
  sha256: string;
  expiresAt: number;
}

export interface PluginUpdateJournalEvidence {
  phase?: unknown;
  id?: unknown;
  action?: unknown;
  version?: unknown;
  packageSha256?: unknown;
}

export function issuePluginRuntimeRestart(input: {
  id: string;
  version: string;
  sha256: string;
  nowMs?: number;
  ttlMs?: number;
}): PendingPluginRuntimeRestart {
  if (!input.id || !input.version || !/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw new PenglaiError("SECURITY_POLICY", "plugin runtime restart identity is incomplete");
  }
  const now = input.nowMs ?? Date.now();
  const ttl = input.ttlMs ?? 2 * 60_000;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 5 * 60_000) {
    throw new PenglaiError("SECURITY_POLICY", "plugin runtime restart ttl is invalid");
  }
  return {
    id: input.id,
    version: input.version,
    sha256: input.sha256,
    expiresAt: now + ttl,
  };
}

export function verifyPluginRuntimeRestart(input: {
  pending: PendingPluginRuntimeRestart | undefined;
  requestedId: string;
  journal: PluginUpdateJournalEvidence;
  nowMs?: number;
}): PendingPluginRuntimeRestart {
  const pending = input.pending;
  if (!pending || (input.nowMs ?? Date.now()) > pending.expiresAt) {
    throw new PenglaiError("SECURITY_POLICY", "plugin runtime restart authorization expired");
  }
  if (
    input.requestedId !== pending.id ||
    input.journal.phase !== "committed" ||
    input.journal.action !== "update" ||
    input.journal.id !== pending.id ||
    input.journal.version !== pending.version ||
    input.journal.packageSha256 !== pending.sha256
  ) {
    throw new PenglaiError("SECURITY_POLICY", "plugin runtime restart evidence mismatch");
  }
  return pending;
}
