import { PenglaiError } from "@penglai/contracts";

export type CompanionIntensity = "gentle" | "balanced" | "frequent";
export type CompanionDeliveryMode = "text" | "voice" | "text+voice";
export type CompanionLocale = "zh" | "en";
export type CompanionSignal = "periodic" | "reminder" | "idle" | "emotion";
export type CompanionPhase = "disabled" | "enabling" | "enabled" | "failed";

export interface CompanionEnableInput {
  bindingId: string;
  workspaceId: string;
  sessionId: string;
  quietStartHour: number;
  quietEndHour: number;
  dailyCap: number;
  recentInteractionMinutes: number;
  intensity: CompanionIntensity;
  deliveryMode: CompanionDeliveryMode;
  locale: CompanionLocale;
  signals: CompanionSignal[];
}

export interface CompanionConfig {
  revision: number;
  phase: CompanionPhase;
  enabled: boolean;
  bindingId?: string;
  workspaceId?: string;
  boundSessionId?: string;
  companionSessionId?: string;
  provider?: string;
  model?: string;
  workspacePath?: string;
  quietStartHour: number;
  quietEndHour: number;
  dailyCap: number;
  recentInteractionMinutes: number;
  intensity: CompanionIntensity;
  deliveryMode: CompanionDeliveryMode;
  locale: CompanionLocale;
  signals: CompanionSignal[];
  permission: "plan/no-unattended-tools";
}

export const FRESH_COMPANION: CompanionConfig = {
  revision: 0,
  phase: "disabled",
  enabled: false,
  quietStartHour: 22,
  quietEndHour: 8,
  dailyCap: 1,
  recentInteractionMinutes: 90,
  intensity: "gentle",
  deliveryMode: "text",
  locale: "zh",
  signals: [],
  permission: "plan/no-unattended-tools",
};

export function intensitySeconds(intensity: CompanionIntensity): number {
  if (intensity === "gentle") return 86_400;
  if (intensity === "balanced") return 43_200;
  return 21_600;
}

export function inQuietHours(
  hour: number,
  start: number,
  end: number,
): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function validateEnableInput(input: CompanionEnableInput): void {
  if (!input.bindingId || !input.workspaceId || !input.sessionId) {
    throw new PenglaiError(
      "INVALID_INPUT",
      "companion requires exact binding, Workspace, and Session",
    );
  }
  for (const hour of [input.quietStartHour, input.quietEndHour]) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23)
      throw new PenglaiError("INVALID_INPUT", "companion quiet hour invalid");
  }
  if (
    !Number.isSafeInteger(input.dailyCap) ||
    input.dailyCap < 1 ||
    input.dailyCap > 12
  ) {
    throw new PenglaiError("INVALID_INPUT", "companion daily cap invalid");
  }
  if (
    !Number.isSafeInteger(input.recentInteractionMinutes) ||
    input.recentInteractionMinutes < 0 ||
    input.recentInteractionMinutes > 1440
  ) {
    throw new PenglaiError(
      "INVALID_INPUT",
      "companion recent interaction window invalid",
    );
  }
  if (
    !(["gentle", "balanced", "frequent"] as string[]).includes(input.intensity)
  ) {
    throw new PenglaiError("INVALID_INPUT", "companion intensity invalid");
  }
  if (
    !(["text", "voice", "text+voice"] as string[]).includes(input.deliveryMode)
  ) {
    throw new PenglaiError("INVALID_INPUT", "companion delivery mode invalid");
  }
  if (input.locale !== "zh" && input.locale !== "en")
    throw new PenglaiError("INVALID_INPUT", "companion locale invalid");
  const allowed = new Set<CompanionSignal>([
    "periodic",
    "reminder",
    "idle",
    "emotion",
  ]);
  if (
    !input.signals.length ||
    input.signals.some((signal) => !allowed.has(signal))
  ) {
    throw new PenglaiError(
      "INVALID_INPUT",
      "companion requires explicit valid signals",
    );
  }
  if (new Set(input.signals).size !== input.signals.length)
    throw new PenglaiError("INVALID_INPUT", "duplicate companion signal");
}

export function mayDispatch(
  cfg: CompanionConfig,
  now: number,
  sentToday: number,
  recentUserActivityAt?: number,
): { viaImBinding: string } {
  if (!cfg.enabled || cfg.phase !== "enabled")
    throw new PenglaiError("SECURITY_POLICY", "companion default-off");
  if (
    !cfg.bindingId ||
    !cfg.workspaceId ||
    !cfg.boundSessionId ||
    !cfg.companionSessionId
  ) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "companion requires exact IM binding and official Session",
    );
  }
  if (cfg.permission !== "plan/no-unattended-tools") {
    throw new PenglaiError("SECURITY_POLICY", "companion tools forbidden");
  }
  const hour = new Date(now).getHours();
  if (inQuietHours(hour, cfg.quietStartHour, cfg.quietEndHour)) {
    throw new PenglaiError("SECURITY_POLICY", "companion quiet hours");
  }
  if (sentToday >= cfg.dailyCap)
    throw new PenglaiError("SECURITY_POLICY", "companion daily cap");
  if (
    recentUserActivityAt !== undefined &&
    cfg.recentInteractionMinutes > 0 &&
    now >= recentUserActivityAt &&
    now - recentUserActivityAt < cfg.recentInteractionMinutes * 60_000
  ) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "companion recent interaction pause",
    );
  }
  return { viaImBinding: cfg.bindingId };
}
