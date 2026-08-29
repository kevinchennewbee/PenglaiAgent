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
  requiredPlugins: Array<{ id: string; ok: boolean }>;
  errorCodes: string[];
}

export function redactSupervisorDiagnostic(input: {
  appVersion: string;
  sourceSha: string;
  platform: string;
  arch: string;
  dsh: string;
  phase: string;
  phaseMs: number;
  exitCode?: number;
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
    requiredPlugins: input.requiredPlugins,
    errorCodes: input.errorCodes.slice(0, 8),
  };
}
