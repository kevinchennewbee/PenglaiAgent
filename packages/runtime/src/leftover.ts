import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { PenglaiError, redactEvidenceText } from "@penglai/contracts";

export function classifyStartupFault(err: unknown): "port" | "db-busy" | "corrupt" | "disk-full" | "clock" | "unknown" {
  const text = err instanceof Error ? err.message : String(err ?? "");
  if (/EADDRINUSE|port in use|listen/i.test(text)) return "port";
  if (/SQLITE_BUSY|database is locked/i.test(text)) return "db-busy";
  if (/corrupt|malformed|STORE_CORRUPT/i.test(text)) return "corrupt";
  if (/ENOSPC|disk full|no space/i.test(text)) return "disk-full";
  if (/clock|skew|NTP/i.test(text)) return "clock";
  return "unknown";
}

export function nextReconnectAllowed(attempts: number[], now: number, windowMs = 60_000, max = 6): boolean {
  return attempts.filter((stamp) => now - stamp < windowMs).length < max;
}

export function qrMustClear(expiresAt: number, now: number): boolean {
  return now >= expiresAt;
}

export function persistAppearance(
  settingsPath: string,
  locale: "zh" | "en",
  theme: "light" | "dark" | "system",
): void {
  writeFileSync(settingsPath, `locale:\n  preference: ${locale}\nui-theme:\n  preference: ${theme}\n`, { mode: 0o600 });
}

export function readAppearance(settingsPath: string): { locale: string; theme: string } {
  if (!existsSync(settingsPath)) return { locale: "", theme: "" };
  const text = readFileSync(settingsPath, "utf8");
  return {
    locale: /locale:\s*\n\s*preference:\s*(\w+)/.exec(text)?.[1] ?? "",
    theme: /ui-theme:\s*\n\s*preference:\s*(\w+)/.exec(text)?.[1] ?? "",
  };
}

export function exportDiagnosticsPreview(input: Record<string, unknown>): { preview: string; redacted: true } {
  const raw = JSON.stringify(input);
  if (/\/Users\/[^/\s]+|\/Volumes\/KevinSSD|C:\\Users\\/i.test(raw)) {
    throw new PenglaiError("SECURITY_POLICY", "diagnostics preview contains owner path");
  }
  return { preview: redactEvidenceText(raw), redacted: true };
}

export const OPEN_RISKS: Array<{ id: string; severity: "Critical" | "High" | "Medium" | "Low"; status: "open" | "closed" }> = [];

export function assertNoOpenCriticalHigh(risks = OPEN_RISKS): void {
  // A "zero open Critical/High" claim is only meaningful against a non-empty
  // risk register; an empty default register must not silently pass.
  if (risks.length === 0) {
    throw new PenglaiError("SECURITY_POLICY", "risk register is empty; cannot assert zero open Critical/High");
  }
  const open = risks.filter((risk) => (risk.severity === "Critical" || risk.severity === "High") && risk.status === "open");
  if (open.length) throw new PenglaiError("SECURITY_POLICY", `open ${open.map((r) => r.id).join(",")}`);
}

export const STARTUP_BUDGETS = { coldMs: 15_000, warmMs: 5_000, idleCpuPct: 5, idleRssMb: 800 } as const;
export const QUEUE_BUDGETS = { maxDepth: 32, maxDbGrowthMb: 64 } as const;
export const A11Y_CONTRACT = {
  contrastMin: 4.5,
  zoomMaxPct: 200,
  reducedMotion: true,
  qrHasAlt: true,
  liveRegion: true,
} as const;

export function resourceSnapshot(input: {
  running: boolean;
  timers: number;
  sockets: number;
  dbOpen: boolean;
}): { zero: boolean; workers: number; timers: number; sockets: number; db: number } {
  return {
    zero: !input.running && input.timers === 0 && input.sockets === 0 && !input.dbOpen,
    workers: input.running ? 1 : 0,
    timers: input.timers,
    sockets: input.sockets,
    db: input.dbOpen ? 1 : 0,
  };
}
