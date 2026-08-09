/**
 * 供应商目录（Provider Catalog）— TypeScript Host 的离线种子与实时覆盖层。
 *
 * 数据本体在 catalog.generated.ts（由 scripts/sync-catalog.mjs 从仓库根目录
 * penglai_providers.yaml 生成，全字段保真：计费模式 / 双协议 base_url /
 * 价格 / 上下文 / features / default / deprecated 替换表 / wizard_order）。
 *
 * 本文件提供类型 + 查询 API（向导有序列表、按 id 取供应商、取计费模式、
 * 取模型、deprecated 检查）。查询函数默认读内置目录，也可注入任意目录
 * 文档（测试 / 未来远程目录）。
 */

import { PROVIDER_CATALOG } from "./catalog.generated.js";

// ── 类型（与 yaml schema 一一对应） ─────────────────────────────

export interface CatalogModel {
  id: string;
  display: string;
  /** 上下文窗口（千 tokens）。 */
  context_k?: number;
  /** 最大输出（千 tokens）。 */
  max_output_k?: number;
  /** 元/百万 tokens，缓存未命中输入价。 */
  input_cny?: number;
  /** 元/百万 tokens，缓存命中输入价。 */
  input_cached_cny?: number;
  /** 元/百万 tokens，输出价。 */
  output_cny?: number;
  /** USD 计价（OpenRouter 部分模型）。 */
  input_usd?: number;
  output_usd?: number;
  /** AFP 积分计价（火山 Agent Plan）。 */
  afp_in?: number;
  afp_out?: number;
  /** 完全免费模型。 */
  free?: boolean;
  features?: readonly string[];
  /** 向导默认高亮。 */
  default?: boolean;
}

export interface CatalogPlan {
  id: string;
  display: string;
  price_cny: number;
  afp_month?: number;
  afp_5h?: number;
  desc?: string;
}

export interface BillingMode {
  label: string;
  /** OpenAI 兼容端点（蓬莱实际调用的）；"" = 需手填 / 不适用。 */
  base_url: string;
  /** Anthropic 协议端点（备查）。 */
  base_url_anthropic?: string;
  note?: string;
  warning?: string;
  plans?: readonly CatalogPlan[];
  models: readonly CatalogModel[];
}

export interface DeprecatedModel {
  id: string;
  /** 官方建议的替换模型。 */
  replace: string;
  /** 停服死线（YYYY-MM-DD，可缺省）。 */
  deadline?: string;
}

export interface ProviderEntry {
  display: string;
  signup_url: string;
  billing: Record<string, BillingMode>;
  default_billing: string;
  default_model: string;
  deprecated?: readonly DeprecatedModel[];
}

export interface ProviderCatalogDoc {
  updated: string;
  currency: string;
  wizard_order: readonly string[];
  providers: Record<string, ProviderEntry>;
}

/** 内置目录（生成的 2026-06-29 实测修正版）。 */
export const CATALOG: ProviderCatalogDoc = PROVIDER_CATALOG as ProviderCatalogDoc;

// ── 查询 API ────────────────────────────────────────────────────

/** 目录数据日期（如 "2026-06-29"）。 */
export function catalogUpdated(cat: ProviderCatalogDoc = CATALOG): string {
  return cat.updated;
}

/** 向导展示顺序的供应商 id 列表（custom 永远在目录内但语义特殊）。 */
export function wizardOrder(cat: ProviderCatalogDoc = CATALOG): readonly string[] {
  return cat.wizard_order;
}

export interface OrderedProvider {
  id: string;
  entry: ProviderEntry;
}

/** 按 wizard_order 排列的供应商列表（跳过 order 里不存在的 id）。 */
export function orderedProviders(cat: ProviderCatalogDoc = CATALOG): OrderedProvider[] {
  const out: OrderedProvider[] = [];
  for (const id of cat.wizard_order) {
    const entry = cat.providers[id];
    if (entry) out.push({ id, entry });
  }
  return out;
}

/** 按 id 取供应商；不存在返回 undefined。 */
export function getProvider(id: string, cat: ProviderCatalogDoc = CATALOG): ProviderEntry | undefined {
  return cat.providers[id];
}

/** 供应商的计费模式 id 列表（保持 yaml 书写顺序）。 */
export function billingIds(providerId: string, cat: ProviderCatalogDoc = CATALOG): string[] {
  const provider = getProvider(providerId, cat);
  return provider ? Object.keys(provider.billing) : [];
}

/**
 * 取计费模式。billingId 缺省 = 供应商 default_billing。
 * 供应商或模式不存在返回 undefined。
 */
export function getBilling(
  providerId: string,
  billingId?: string,
  cat: ProviderCatalogDoc = CATALOG,
): BillingMode | undefined {
  const provider = getProvider(providerId, cat);
  if (!provider) return undefined;
  const id = billingId ?? provider.default_billing;
  return provider.billing[id];
}

/** 计费模式短标签（0.3.x `_short` 映射的移植：按量/Coding/Agent/订阅）。 */
export function billingShortTag(billingId: string, mode?: BillingMode): string {
  const known: Record<string, string> = {
    paygo: "按量",
    coding_plan: "Coding",
    agent_plan: "Agent",
    token_plan: "订阅",
  };
  return known[billingId] ?? (mode?.label ?? billingId).split("（")[0];
}

/** 取模型列表。billingId 缺省 = default_billing。 */
export function modelsOf(
  providerId: string,
  billingId?: string,
  cat: ProviderCatalogDoc = CATALOG,
): readonly CatalogModel[] {
  return getBilling(providerId, billingId, cat)?.models ?? [];
}

/**
 * 取默认模型：优先 default 高亮标记，其次供应商 default_model，再次列表首个。
 * 空列表返回 ""。
 */
export function defaultModelOf(
  providerId: string,
  billingId?: string,
  cat: ProviderCatalogDoc = CATALOG,
): string {
  const provider = getProvider(providerId, cat);
  const models = modelsOf(providerId, billingId, cat);
  const flagged = models.find((m) => m.default === true);
  if (flagged) return flagged.id;
  if (provider && models.some((m) => m.id === provider.default_model)) {
    return provider.default_model;
  }
  return models[0]?.id ?? "";
}

/** 按 id 取模型条目（用于把目录价格/特性补充到实时列表）。 */
export function modelById(
  providerId: string,
  billingId: string | undefined,
  modelId: string,
  cat: ProviderCatalogDoc = CATALOG,
): CatalogModel | undefined {
  return modelsOf(providerId, billingId, cat).find((m) => m.id === modelId);
}

/**
 * deprecated 检查：模型在该供应商的废弃替换表里则返回条目（含替换建议
 * 与死线），否则 null。用于向导里「用户选了已废弃模型」的提示。
 */
export function checkDeprecated(
  providerId: string,
  modelId: string,
  cat: ProviderCatalogDoc = CATALOG,
): DeprecatedModel | null {
  const provider = getProvider(providerId, cat);
  if (!provider?.deprecated) return null;
  return provider.deprecated.find((d) => d.id === modelId) ?? null;
}

// ── 展示辅助（向导渲染用，纯函数） ──────────────────────────────

/** 模型价格一句话（人民币优先，USD/AFP/免费各自成句；无价返回 ""）。 */
export function describeModelPrice(model: CatalogModel): string {
  if (model.free === true) return "免费";
  if (typeof model.input_cny === "number" && typeof model.output_cny === "number") {
    const cached =
      typeof model.input_cached_cny === "number" ? `（缓存 ¥${model.input_cached_cny}）` : "";
    return `¥${model.input_cny}${cached} 入 / ¥${model.output_cny} 出 每百万`;
  }
  if (typeof model.input_usd === "number" && typeof model.output_usd === "number") {
    return `$${model.input_usd} 入 / $${model.output_usd} 出 每百万`;
  }
  if (typeof model.afp_in === "number" && typeof model.afp_out === "number") {
    return `${model.afp_in}/${model.afp_out} AFP 积分 每千`;
  }
  return "";
}

/** 模型上下文一句话（如 "256K"，缺省 ""）。 */
export function describeModelContext(model: CatalogModel): string {
  return typeof model.context_k === "number" ? `${model.context_k}K` : "";
}

/**
 * Look up a catalog model by id across all providers/billing modes.
 * Used when assembling ModelProfile context windows from SSOT catalog.
 *
 * Same model id can appear in multiple billing modes (e.g. MiniMax-M3 on
 * paygo has context_k=1000, token_plan omits it). Prefer the entry that
 * declares a real context window so BYOK profiles don't fall back to 128k
 * or null just because the first hit was a thin subscription listing.
 */
export function findCatalogModel(
  modelId: string,
  cat: ProviderCatalogDoc = CATALOG,
): CatalogModel | null {
  const needle = modelId.trim();
  if (!needle) return null;
  let fallback: CatalogModel | null = null;
  for (const provider of Object.values(cat.providers ?? {})) {
    for (const mode of Object.values(provider.billing ?? {})) {
      for (const model of mode.models ?? []) {
        if (model.id !== needle) continue;
        if (typeof model.context_k === "number" && model.context_k > 0) {
          return model;
        }
        if (!fallback) fallback = model;
      }
    }
  }
  return fallback;
}

/** context_k (thousand tokens) → absolute token count for Pi/host. */
export function catalogContextTokens(model: CatalogModel | null | undefined): number | null {
  if (!model || typeof model.context_k !== "number" || !(model.context_k > 0)) return null;
  return Math.floor(model.context_k * 1000);
}

export function catalogMaxOutputTokens(model: CatalogModel | null | undefined): number | null {
  if (!model || typeof model.max_output_k !== "number" || !(model.max_output_k > 0)) return null;
  return Math.floor(model.max_output_k * 1000);
}

/** Human label for a token window (e.g. 1000000 → "1000k", 128000 → "128k"). */
export function formatContextWindowLabel(tokens: number | null | undefined): string {
  if (!tokens || !(tokens > 0)) return "未知";
  if (tokens % 1000 === 0) return `${tokens / 1000}k`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}
