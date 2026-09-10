import { PenglaiError } from "@penglai/contracts";
import type { OfficialUsableCtx } from "./onboarding.js";

export const DEEPSEEK_SETTINGS_NS = "llm-deepseek";
export const DEFAULT_IMAGE_PIXEL_BUDGET = 640_000;
export const DEFAULT_IMAGE_MAX_BYTES = 1_048_576;

export type CatalogModelDraft = {
  id: string;
  inputModalities: string[];
  [key: string]: unknown;
};

export function modalitiesAcceptImage(modalities: readonly string[] | undefined): boolean {
  return Array.isArray(modalities) && modalities.includes("image");
}

export function withImageModality(_modalities: readonly string[] | undefined, enabled: boolean): string[] {
  return enabled ? ["text", "image"] : ["text"];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function catalogModelFromUnknown(value: unknown): CatalogModelDraft | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  if (!id) return undefined;
  const modalities = Array.isArray(rec.inputModalities)
    ? rec.inputModalities.filter((row): row is string => row === "text" || row === "image")
    : ["text"];
  const inputModalities = modalities.length > 0 ? [...new Set(modalities)] : ["text"];
  const image = modalitiesAcceptImage(inputModalities);
  const next: CatalogModelDraft = {
    ...rec,
    id,
    inputModalities,
  };
  if (image) {
    next.imagePixelBudget =
      rec.imagePixelBudget === "low"
        ? "low"
        : typeof rec.imagePixelBudget === "number" && rec.imagePixelBudget > 0
          ? rec.imagePixelBudget
          : DEFAULT_IMAGE_PIXEL_BUDGET;
    next.imageMaxBytes =
      typeof rec.imageMaxBytes === "number" && rec.imageMaxBytes > 0
        ? rec.imageMaxBytes
        : DEFAULT_IMAGE_MAX_BYTES;
  } else {
    delete next.imagePixelBudget;
    delete next.imageMaxBytes;
  }
  return next;
}

export function catalogModelsFromSettingsValue(value: unknown): CatalogModelDraft[] {
  const rec = asRecord(value);
  const rows = Array.isArray(rec?.models) ? rec.models : Array.isArray(value) ? value : [];
  return rows.map(catalogModelFromUnknown).filter((row): row is CatalogModelDraft => Boolean(row));
}

export function applyImageInputToCatalog(
  models: readonly CatalogModelDraft[],
  modelId: string,
  enabled: boolean,
): CatalogModelDraft[] {
  const id = modelId.trim();
  if (!id) throw new PenglaiError("INVALID_INPUT", "model id required");
  if (!models.some((row) => row.id === id)) {
    throw new PenglaiError("INVALID_INPUT", `model "${id}" is not in the official DeepSeek catalog`);
  }
  return models.map((row) => {
    if (row.id !== id) return { ...row, inputModalities: [...row.inputModalities] };
    const inputModalities = withImageModality(row.inputModalities, enabled);
    const image = modalitiesAcceptImage(inputModalities);
    const next: CatalogModelDraft = {
      ...row,
      id: row.id,
      inputModalities,
    };
    if (image) {
      next.imagePixelBudget = row.imagePixelBudget ?? DEFAULT_IMAGE_PIXEL_BUDGET;
      next.imageMaxBytes = row.imageMaxBytes ?? DEFAULT_IMAGE_MAX_BYTES;
    } else {
      delete next.imagePixelBudget;
      delete next.imageMaxBytes;
    }
    return next;
  });
}

const CATALOG_MODEL_KEYS = [
  "id",
  "name",
  "description",
  "contextWindow",
  "maxTokens",
  "inputModalities",
  "imagePixelBudget",
  "imageMaxBytes",
  "systemPromptUpdate",
] as const;

function catalogSeedFromResolvedInfo(info: Record<string, unknown>, id: string): Record<string, unknown> {
  const context = asRecord(info.context);
  const seed: Record<string, unknown> = { id };
  for (const key of CATALOG_MODEL_KEYS) {
    if (key === "id") continue;
    if (info[key] !== undefined) seed[key] = info[key];
  }
  if (seed.contextWindow === undefined && typeof context?.contextWindow === "number") {
    seed.contextWindow = context.contextWindow;
  }
  if (seed.maxTokens === undefined && typeof info.defaultMaxTokens === "number") {
    seed.maxTokens = info.defaultMaxTokens;
  }
  return seed;
}

export async function listOfficialDeepSeekCatalog(official: OfficialUsableCtx): Promise<CatalogModelDraft[]> {
  const described = official.settings?.describe?.() ?? [];
  const ns = described.find((row) => row.ns === DEEPSEEK_SETTINGS_NS);
  const fromSettings = catalogModelsFromSettingsValue(ns?.value);
  if (fromSettings.length > 0) return fromSettings;
  if (!official.llm?.listModels) {
    throw new PenglaiError("DSH_UNAVAILABLE", "official model directory missing");
  }
  const listed = await official.llm.listModels("deepseek-official");
  const rows: CatalogModelDraft[] = [];
  for (const entry of listed) {
    const id = typeof entry?.id === "string" ? entry.id : "";
    if (!id) continue;
    let extra: Record<string, unknown> = asRecord(entry) ?? {};
    if (official.llm.resolveModelInfo) {
      try {
        const info = asRecord(await official.llm.resolveModelInfo("deepseek-official", id)) ?? {};
        extra = { ...catalogSeedFromResolvedInfo(info, id) };
      } catch {
        extra = asRecord(entry) ?? {};
      }
    }
    const rebuilt = catalogModelFromUnknown({ ...extra, id });
    if (rebuilt) rows.push(rebuilt);
  }
  return rows;
}

export async function setOfficialDeepSeekImageInput(
  official: OfficialUsableCtx,
  input: { modelId: string; enabled: boolean },
): Promise<CatalogModelDraft[]> {
  if (!official.settings?.mutate) {
    throw new PenglaiError("DSH_UNAVAILABLE", "official settings mutate missing");
  }
  const current = await listOfficialDeepSeekCatalog(official);
  const next = applyImageInputToCatalog(current, input.modelId, input.enabled === true);
  await official.settings.mutate(DEEPSEEK_SETTINGS_NS, [{ op: "set", path: ["models"], value: next }]);
  return next;
}
