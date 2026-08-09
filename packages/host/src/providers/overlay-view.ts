/**
 * 目录校准覆盖层的纯函数视图（无 fs，可在浏览器侧打包）。
 *
 * overlay.ts 负责持久化（node:fs）；本文件是同一机制的纯查询/文案面，
 * 桌面端首次启动向导经 catalog.status RPC 拿到覆盖层后，用这些纯函数
 * 渲染「已知模型 N 个 · 校准于 <时间>」状态行——与 CLI 向导完全同语义。
 */

import type { ProviderCatalogDoc } from "./catalog.js";

// ── 类型 ───────────────────────────────────────────────────────

export interface CatalogOverlayEntry {
  providerId: string;
  billingId: string;
  /** 校准时实际调用的端点（档案的 baseUrl）。 */
  baseUrl: string;
  /** 上次成功 GET /models 返回的实时模型 id（顺序保留）。 */
  modelIds: string[];
  /** 成功校准的时刻（epoch ms）。 */
  checkedAt: number;
}

/** 取某个供应商/计费模式的校准记录；未校准返回 undefined。 */
export function overlayEntryFor(
  overlay: readonly CatalogOverlayEntry[],
  providerId: string,
  billingId: string,
): CatalogOverlayEntry | undefined {
  return overlay.find(
    (e) => e.providerId === providerId && e.billingId === billingId,
  );
}

// ── 合并：覆盖层模型 id 并入目录文档（种子模型与价格保留，实时新增排尾） ──

/**
 * 返回一个新目录文档：有校准记录的计费模式，其 models 在种子列表之后追加
 * 「只在实时列表里」的 id（display 用 id 本体，无价格/特性——那些是种子层
 * 字段，不发明）。无校准记录的模式原样保留。
 */
export function withOverlayModels(
  cat: ProviderCatalogDoc,
  overlay: readonly CatalogOverlayEntry[],
): ProviderCatalogDoc {
  if (overlay.length === 0) return cat;
  const providers: ProviderCatalogDoc["providers"] = {};
  for (const [id, entry] of Object.entries(cat.providers)) {
    const billing: typeof entry.billing = {};
    for (const [bid, mode] of Object.entries(entry.billing)) {
      const hit = overlayEntryFor(overlay, id, bid);
      if (!hit) {
        billing[bid] = mode;
        continue;
      }
      const known = new Set(mode.models.map((m) => m.id));
      const extras = hit.modelIds
        .filter((mid) => !known.has(mid))
        .map((mid) => ({ id: mid, display: mid }));
      billing[bid] = { ...mode, models: [...mode.models, ...extras] };
    }
    providers[id] = { ...entry, billing };
  }
  return { ...cat, providers };
}

/** 校准状态一行文案（向导/面板共用）：「已知模型 N 个 · 校准于 <时间>」或 null。 */
export function calibrationLine(
  entry: CatalogOverlayEntry | undefined,
  now: number = Date.now(),
): string | null {
  if (!entry) return null;
  const ageMs = Math.max(0, now - entry.checkedAt);
  const days = Math.floor(ageMs / 86_400_000);
  const when =
    days >= 1
      ? `${days} 天前`
      : ageMs >= 3_600_000
        ? `${Math.floor(ageMs / 3_600_000)} 小时前`
        : `${Math.max(1, Math.floor(ageMs / 60_000))} 分钟前`;
  return `已知模型 ${entry.modelIds.length} 个 · 校准于 ${when}`;
}
