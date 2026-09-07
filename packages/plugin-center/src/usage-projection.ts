type UsageAvailability = "available" | "unavailable" | "estimated";

function finiteCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Local copy of the read-only official usage projection so tests do not need a rebuilt contracts dist. */
export function projectOfficialUsage(input: {
  occupancyTokens?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheWriteTokens?: unknown;
  estimatedCost?: unknown;
  estimatedCurrency?: unknown;
}) {
  const occupancy = finiteCount(input.occupancyTokens);
  const inputTokens = finiteCount(input.inputTokens);
  const outputTokens = finiteCount(input.outputTokens);
  const cacheRead = finiteCount(input.cacheReadTokens);
  const cacheWrite = finiteCount(input.cacheWriteTokens);
  const amount = typeof input.estimatedCost === "number" && Number.isFinite(input.estimatedCost) ? input.estimatedCost : undefined;
  const currency = typeof input.estimatedCurrency === "string" && /^[A-Z]{3}$/.test(input.estimatedCurrency) ? input.estimatedCurrency : undefined;
  return {
    occupancy: occupancy === undefined ? { availability: "unavailable" as UsageAvailability } : { tokens: occupancy, availability: "available" as const },
    cumulative:
      inputTokens === undefined && outputTokens === undefined
        ? { availability: "unavailable" as const }
        : { ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}), availability: "available" as const },
    cache:
      cacheRead === undefined && cacheWrite === undefined
        ? { availability: "unavailable" as const }
        : { ...(cacheRead !== undefined ? { readTokens: cacheRead } : {}), ...(cacheWrite !== undefined ? { writeTokens: cacheWrite } : {}), availability: "available" as const },
    estimatedCost:
      amount === undefined
        ? { availability: "unavailable" as const }
        : { amount, ...(currency ? { currency } : {}), availability: "estimated" as const },
  };
}
