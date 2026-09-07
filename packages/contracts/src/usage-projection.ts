export type UsageAvailability = "available" | "unavailable" | "estimated";

export interface OfficialUsageProjection {
  occupancy: { tokens?: number; availability: UsageAvailability };
  cumulative: { inputTokens?: number; outputTokens?: number; availability: UsageAvailability };
  cache: { readTokens?: number; writeTokens?: number; availability: UsageAvailability };
  estimatedCost: { amount?: number; currency?: string; availability: UsageAvailability };
}

function finiteCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Read-only projection of official accounting. Missing fields stay unavailable; this never enables Budget enforcement. */
export function projectOfficialUsage(input: {
  occupancyTokens?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheWriteTokens?: unknown;
  estimatedCost?: unknown;
  estimatedCurrency?: unknown;
}): OfficialUsageProjection {
  const occupancy = finiteCount(input.occupancyTokens);
  const inputTokens = finiteCount(input.inputTokens);
  const outputTokens = finiteCount(input.outputTokens);
  const cacheRead = finiteCount(input.cacheReadTokens);
  const cacheWrite = finiteCount(input.cacheWriteTokens);
  const amount = typeof input.estimatedCost === "number" && Number.isFinite(input.estimatedCost) ? input.estimatedCost : undefined;
  const currency = typeof input.estimatedCurrency === "string" && /^[A-Z]{3}$/.test(input.estimatedCurrency) ? input.estimatedCurrency : undefined;
  return {
    occupancy: occupancy === undefined ? { availability: "unavailable" } : { tokens: occupancy, availability: "available" },
    cumulative:
      inputTokens === undefined && outputTokens === undefined
        ? { availability: "unavailable" }
        : { ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}), availability: "available" },
    cache:
      cacheRead === undefined && cacheWrite === undefined
        ? { availability: "unavailable" }
        : { ...(cacheRead !== undefined ? { readTokens: cacheRead } : {}), ...(cacheWrite !== undefined ? { writeTokens: cacheWrite } : {}), availability: "available" },
    estimatedCost:
      amount === undefined
        ? { availability: "unavailable" }
        : { amount, ...(currency ? { currency } : {}), availability: "estimated" },
  };
}
