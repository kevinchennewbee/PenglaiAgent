/**
 * usage.stats — ZCode-inspired cost visibility without inventing fake charts.
 * Built from product-store usage_counters + optional model attribution file.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { UsageReport, UsageRow } from "@penglai/protocol";
import { localDay } from "./usage.js";

export type UsageRange = "7d" | "30d" | "all";

export interface UsageModelHit {
  model: string;
  modelProfileId?: string;
  tokens: number;
  requests: number;
  day: string;
}

export interface UsageStats {
  range: UsageRange;
  fromDay: string | null;
  toDay: string;
  totalTokens: number;
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
  activeDays: number;
  currentStreakDays: number;
  topModel: { model: string; tokens: number; share: number } | null;
  daily: Array<{ day: string; tokens: number; requests: number }>;
  byModel: Array<{ model: string; tokens: number; requests: number; share: number }>;
  /** days with any activity for heatmap dots */
  activeDaySet: string[];
}

function dayOffset(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return localDay(dt);
}

function daysInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  // safety cap
  for (let i = 0; i < 400 && cur <= to; i++) {
    out.push(cur);
    cur = dayOffset(cur, 1);
  }
  return out;
}

export function modelLedgerPath(dataDir: string): string {
  return path.join(dataDir, "usage-models.jsonl");
}

/** Append one episode's model attribution (best-effort, never throws to callers). */
export function recordModelUsage(
  dataDir: string,
  hit: { model?: string; modelProfileId?: string; tokens: number; requests?: number; day?: string },
): void {
  const model = (hit.model || hit.modelProfileId || "").trim();
  if (!model) return;
  const row: UsageModelHit = {
    model,
    modelProfileId: hit.modelProfileId,
    tokens: Math.max(0, Math.trunc(hit.tokens)),
    requests: Math.max(0, Math.trunc(hit.requests ?? 1)),
    day: hit.day || localDay(),
  };
  try {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(modelLedgerPath(dataDir), `${JSON.stringify(row)}\n`, { encoding: "utf-8" });
  } catch {
    /* ignore */
  }
}

function readModelHits(dataDir: string): UsageModelHit[] {
  try {
    const raw = fs.readFileSync(modelLedgerPath(dataDir), "utf-8");
    const hits: UsageModelHit[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line) as UsageModelHit;
        if (o && typeof o.model === "string") hits.push(o);
      } catch {
        /* skip bad line */
      }
    }
    return hits;
  } catch {
    return [];
  }
}

function streakFromActiveDays(activeSortedDesc: string[], today: string): number {
  if (activeSortedDesc.length === 0) return 0;
  let streak = 0;
  let expect = today;
  // allow yesterday start if no activity today yet
  if (activeSortedDesc[0] !== today && activeSortedDesc[0] !== dayOffset(today, -1)) return 0;
  if (activeSortedDesc[0] === dayOffset(today, -1)) expect = dayOffset(today, -1);
  for (const day of activeSortedDesc) {
    if (day === expect) {
      streak += 1;
      expect = dayOffset(expect, -1);
    } else if (day < expect) break;
  }
  return streak;
}

export function buildUsageStats(
  report: UsageReport,
  dataDir: string,
  range: UsageRange = "30d",
): UsageStats {
  const today = localDay();
  const fromDay =
    range === "all" ? null : dayOffset(today, range === "7d" ? -6 : -29);

  const rows: UsageRow[] = report.rows.filter((row) => !fromDay || row.day >= fromDay);
  const dailyMap = new Map<string, { tokens: number; requests: number }>();
  let inputTokens = 0;
  let outputTokens = 0;
  let totalRequests = 0;
  for (const row of rows) {
    const tokens = row.inputTokens + row.outputTokens;
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    totalRequests += row.requests;
    const prev = dailyMap.get(row.day) ?? { tokens: 0, requests: 0 };
    prev.tokens += tokens;
    prev.requests += row.requests;
    dailyMap.set(row.day, prev);
  }

  const activeDaySet = [...dailyMap.keys()].filter((d) => (dailyMap.get(d)?.tokens ?? 0) > 0 || (dailyMap.get(d)?.requests ?? 0) > 0).sort();
  const daily = (fromDay ? daysInclusive(fromDay, today) : activeDaySet).map((day) => ({
    day,
    tokens: dailyMap.get(day)?.tokens ?? 0,
    requests: dailyMap.get(day)?.requests ?? 0,
  }));

  const modelMap = new Map<string, { tokens: number; requests: number }>();
  for (const hit of readModelHits(dataDir)) {
    if (fromDay && hit.day < fromDay) continue;
    const prev = modelMap.get(hit.model) ?? { tokens: 0, requests: 0 };
    prev.tokens += hit.tokens;
    prev.requests += hit.requests;
    modelMap.set(hit.model, prev);
  }
  const modelTotal = [...modelMap.values()].reduce((s, v) => s + v.tokens, 0) || 1;
  const byModel = [...modelMap.entries()]
    .map(([model, v]) => ({
      model,
      tokens: v.tokens,
      requests: v.requests,
      share: v.tokens / modelTotal,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  const totalTokens = inputTokens + outputTokens;
  const top = byModel[0]
    ? { model: byModel[0].model, tokens: byModel[0].tokens, share: byModel[0].share }
    : null;

  const activeDesc = [...activeDaySet].sort((a, b) => (a < b ? 1 : -1));

  return {
    range,
    fromDay,
    toDay: today,
    totalTokens,
    totalRequests,
    inputTokens,
    outputTokens,
    activeDays: activeDaySet.length,
    currentStreakDays: streakFromActiveDays(activeDesc, today),
    topModel: top,
    daily,
    byModel,
    activeDaySet,
  };
}
