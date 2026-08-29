export const BOOT_PHASES = [
  "boot",
  "checking-private-data",
  "verifying-runtime",
  "starting-dsh",
  "waiting-http",
  "verifying-required-plugins",
  "ready",
] as const;

export type BootPhase = (typeof BOOT_PHASES)[number];

export const SUPERVISOR_RESTART_WINDOW_MS = 5 * 60_000;
export const SUPERVISOR_RESTART_MAX = 3;
export const SUPERVISOR_BACKOFF_MS = [1_000, 3_000, 10_000] as const;
export const SUPERVISOR_HEALTH_INTERVAL_MS = 5_000;
export const SUPERVISOR_HEALTH_TIMEOUT_MS = 2_000;
export const SUPERVISOR_HEALTH_FAILURE_THRESHOLD = 3;
export const SUPERVISOR_UNHEALTHY_KILL_GRACE_MS = 2_000;

export const SUPERVISOR_RECOVERY_STATUSES = [
  "idle",
  "recovering",
  "recovered",
  "manual-action-required",
] as const;
export type SupervisorRecoveryStatus = (typeof SUPERVISOR_RECOVERY_STATUSES)[number];

export const SUPERVISOR_RECOVERY_REASONS = [
  "none",
  "process-exit",
  "health-check-failed",
  "restart-start-failed",
  "restart-budget-exhausted",
] as const;
export type SupervisorRecoveryReason = (typeof SUPERVISOR_RECOVERY_REASONS)[number];
export type SupervisorFailureTrigger = Exclude<SupervisorRecoveryReason, "none" | "restart-budget-exhausted">;

export interface SupervisorRecoverySnapshot {
  status: SupervisorRecoveryStatus;
  reason: SupervisorRecoveryReason;
  attempt: number;
  maxAttempts: number;
  exitCode: number | null;
  trigger: SupervisorFailureTrigger | "none";
  lastFailure: SupervisorFailureTrigger | "none";
}

export const IDLE_SUPERVISOR_RECOVERY: Readonly<SupervisorRecoverySnapshot> = Object.freeze({
  status: "idle",
  reason: "none",
  attempt: 0,
  maxAttempts: SUPERVISOR_RESTART_MAX,
  exitCode: null,
  trigger: "none",
  lastFailure: "none",
});

export interface SupervisorHealthDecision {
  consecutiveFailures: number;
  state: "healthy" | "degraded";
  restart: boolean;
}

export function nextSupervisorHealthDecision(
  consecutiveFailures: number,
  healthy: boolean,
  threshold = SUPERVISOR_HEALTH_FAILURE_THRESHOLD,
): SupervisorHealthDecision {
  if (healthy) return { consecutiveFailures: 0, state: "healthy", restart: false };
  const failures = Math.max(0, Math.floor(consecutiveFailures)) + 1;
  return {
    consecutiveFailures: failures,
    state: "degraded",
    restart: failures >= Math.max(1, Math.floor(threshold)),
  };
}

export function reusableSupervisorPort(port: number | undefined): number | undefined {
  return Number.isInteger(port) && port !== undefined && port > 0 && port <= 65_535
    ? port
    : undefined;
}

export function supervisorRestartAllowed(
  stamps: readonly number[],
  now = Date.now(),
  windowMs = SUPERVISOR_RESTART_WINDOW_MS,
  max = SUPERVISOR_RESTART_MAX,
): boolean {
  return stamps.filter((stamp) => now - stamp < windowMs).length < max;
}

export function supervisorBackoffMs(attempt: number, jitter = 0): number {
  const index = Math.min(Math.max(0, attempt), SUPERVISOR_BACKOFF_MS.length - 1);
  return SUPERVISOR_BACKOFF_MS[index]! + Math.round(Math.min(1, Math.max(0, jitter)) * 250);
}

export function shouldRestartAfterExit(input: { intentional: boolean; state: string; stamps: readonly number[]; now?: number }): boolean {
  if (input.intentional) return false;
  if (input.state === "stopping" || input.state === "starting") return false;
  return supervisorRestartAllowed(input.stamps, input.now);
}

export interface RedactedSupervisorDiagnostic {
  appVersion: string;
  sourceSha: string;
  platform: string;
  arch: string;
  dsh: string;
  phase: BootPhase | string;
  phaseMs: number;
  exitCode: number | null;
  restartCount: number;
  recovery: SupervisorRecoverySnapshot;
  requiredPlugins: Array<{ id: string; ok: boolean }>;
  errorCodes: string[];
}

export function retainPrimarySupervisorDiagnostic(
  current: RedactedSupervisorDiagnostic | undefined,
  candidate: RedactedSupervisorDiagnostic,
): RedactedSupervisorDiagnostic {
  if (!current) return candidate;
  const currentHasCause = current.recovery.trigger !== "none";
  const candidateHasCause = candidate.recovery.trigger !== "none";
  if (!currentHasCause && candidateHasCause) return candidate;
  return current;
}

export function redactSupervisorDiagnostic(input: {
  appVersion: string;
  sourceSha: string;
  platform: string;
  arch: string;
  dsh: string;
  phase: string;
  phaseMs: number;
  exitCode?: number | null;
  restartCount?: number;
  recovery?: SupervisorRecoverySnapshot;
  requiredPlugins: Array<{ id: string; ok: boolean }>;
  errorCodes: string[];
  home?: string;
  token?: string;
  command?: string;
}): RedactedSupervisorDiagnostic {
  void input.home;
  void input.token;
  void input.command;
  return {
    appVersion: input.appVersion,
    sourceSha: input.sourceSha,
    platform: input.platform,
    arch: input.arch,
    dsh: input.dsh,
    phase: input.phase,
    phaseMs: input.phaseMs,
    exitCode: input.exitCode ?? null,
    restartCount: Math.max(0, Math.floor(input.restartCount ?? 0)),
    recovery: { ...(input.recovery ?? IDLE_SUPERVISOR_RECOVERY) },
    requiredPlugins: input.requiredPlugins.slice(0, 16).map((row) => ({ id: row.id, ok: row.ok })),
    errorCodes: input.errorCodes.filter((code) => /^[A-Z][A-Z0-9_]{0,47}$/.test(code)).slice(0, 8),
  };
}

function recoveryReasonErrorCode(reason: SupervisorRecoveryReason): string | undefined {
  switch (reason) {
    case "process-exit": return "DSH_PROCESS_EXIT";
    case "health-check-failed": return "DSH_HEALTH_CHECK_FAILED";
    case "restart-start-failed": return "DSH_RESTART_START_FAILED";
    case "restart-budget-exhausted": return "DSH_RESTART_BUDGET_EXHAUSTED";
    case "none": return undefined;
  }
}

export function supervisorRecoveryErrorCodes(snapshot: SupervisorRecoverySnapshot): string[] {
  const codes = [
    recoveryReasonErrorCode(snapshot.reason),
    recoveryReasonErrorCode(snapshot.trigger),
    recoveryReasonErrorCode(snapshot.lastFailure),
  ]
    .filter((code): code is string => Boolean(code));
  return [...new Set(codes)];
}

export function redactSupervisorLog(
  text: string,
  privatePaths: readonly string[] = [],
  maxCharacters = 20_000,
): string {
  let redacted = text;
  for (const path of privatePaths.filter(Boolean).sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(path).join("[private-path]");
  }
  redacted = redacted
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]")
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, "$1 [redacted]")
    .replace(/\b(api[_-]?key|secret|token|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/([?&](?:api[_-]?key|secret|token|password)=)[^&\s]+/gi, "$1[redacted]");
  return redacted.slice(-Math.max(0, Math.floor(maxCharacters)));
}
