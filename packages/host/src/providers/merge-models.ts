/**
 * Browser-safe pure model merge helpers.
 *
 * Intentionally free of node:*, undici, and network-safety imports so Desktop
 * renderer can re-export this module without pulling Host-only DNS/fetch code
 * into the Vite bundle (R11).
 */

import type { CatalogModel } from "./catalog.js";

/** Failure classes for list-models RPC (browser-safe type only). */
export type ListModelsFailureKind = "auth" | "network" | "endpoint" | "timeout";

export interface ListModelsResult {
  ok: boolean;
  kind: "ok" | ListModelsFailureKind;
  /** 实时模型 id（拉取成功时）。 */
  ids: string[];
  /** 人类可读一行说明（中文，向导面向）。 */
  detail: string;
}

export interface MergedModel {
  id: string;
  /** 展示名（目录有则用目录 display，实时新增用 id 本体）。 */
  display: string;
  /** 目录条目（实时列表里没有对应目录信息时为 undefined）。 */
  catalog?: CatalogModel;
  /** live = 只在实时列表；catalog = 只在目录；both = 两边都有。 */
  source: "live" | "catalog" | "both";
  /** 目录 default 高亮。 */
  isDefault: boolean;
}

/**
 * 合并实时列表与目录模型：实时列表顺序优先，目录价格/特性/上下文按 id
 * 匹配补充；目录里剩余模型排在后面（source="catalog"）。
 */
export function mergeModels(
  catalogModels: readonly CatalogModel[],
  liveIds: readonly string[],
): MergedModel[] {
  const byId = new Map(catalogModels.map((m) => [m.id, m]));
  const merged: MergedModel[] = [];
  const seen = new Set<string>();
  for (const id of liveIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const catalog = byId.get(id);
    merged.push({
      id,
      display: catalog?.display ?? id,
      ...(catalog ? { catalog } : {}),
      source: catalog ? "both" : "live",
      isDefault: catalog?.default === true,
    });
  }
  for (const model of catalogModels) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    merged.push({
      id: model.id,
      display: model.display,
      catalog: model,
      source: "catalog",
      isDefault: model.default === true,
    });
  }
  return merged;
}
