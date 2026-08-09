/**
 * 实时模型列表（超越 0.3.x 的新能力）。
 *
 * OpenAI 兼容端点约定 `GET {base_url}/models` 返回 { data: [{id}, …] }。
 * 向导在两个时点调用：
 *   1. 选模型页（无 key，探测性；多数供应商 401 → 自动降级为纯目录展示）；
 *   2. 冒烟验证通过后（带 key，确认所选模型在实时列表中）。
 *
 * 失败一律分类降级（auth/network/endpoint/timeout），绝不打断向导。
 */

import type { CatalogModel } from "./catalog.js";
import { assertSafeProviderBaseUrl } from "./url-safety.js";

export type ListModelsFailureKind = "auth" | "network" | "endpoint" | "timeout";

export interface ListModelsResult {
  ok: boolean;
  kind: "ok" | ListModelsFailureKind;
  /** 实时模型 id（拉取成功时）。 */
  ids: string[];
  /** 人类可读一行说明（中文，向导面向）。 */
  detail: string;
}

export interface ListModelsInput {
  baseUrl: string;
  /** 可空（探测性调用 / 本地端点无需鉴权）。 */
  apiKey?: string;
  timeoutMs?: number;
}

const MAX_ERROR_EXCERPT = 120;

async function errorExcerpt(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown }; message?: unknown };
    const message =
      (typeof body?.error?.message === "string" && body.error.message) ||
      (typeof body?.message === "string" && body.message) ||
      "";
    return message.slice(0, MAX_ERROR_EXCERPT);
  } catch {
    return "";
  }
}

/** 拉取实时模型列表；任何失败都返回分类结果，不抛异常。 */
export async function listRemoteModels(input: ListModelsInput): Promise<ListModelsResult> {
  const timeoutMs = input.timeoutMs ?? 8_000;
  const url = `${assertSafeProviderBaseUrl(input.baseUrl)}/models`;
  const headers: Record<string, string> = {};
  if (input.apiKey?.trim()) headers.Authorization = `Bearer ${input.apiKey.trim()}`;

  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, kind: "timeout", ids: [], detail: `拉取模型列表超时（${Math.round(timeoutMs / 1000)}s）` };
    }
    return { ok: false, kind: "network", ids: [], detail: "模型列表不可达（网络或端点地址问题）" };
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return { ok: false, kind: "auth", ids: [], detail: "模型列表需要鉴权（展示内置目录）" };
    }
    const excerpt = await errorExcerpt(res);
    return {
      ok: false,
      kind: "endpoint",
      ids: [],
      detail: `模型列表端点返回 HTTP ${res.status}${excerpt ? `：${excerpt}` : ""}（展示内置目录）`,
    };
  }

  let ids: string[] = [];
  try {
    const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
    if (Array.isArray(body?.data)) {
      ids = body.data
        .map((entry) => (typeof entry?.id === "string" ? entry.id : ""))
        .filter((id) => id.length > 0);
    }
  } catch {
    return { ok: false, kind: "endpoint", ids: [], detail: "模型列表响应不是合法 JSON（展示内置目录）" };
  }
  if (ids.length === 0) {
    return { ok: false, kind: "endpoint", ids: [], detail: "模型列表为空或格式不符（展示内置目录）" };
  }
  return { ok: true, kind: "ok", ids, detail: `实时模型列表：${ids.length} 个模型` };
}

// ── 合并：实时列表优先，目录信息按 id 补充 ──────────────────────

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
