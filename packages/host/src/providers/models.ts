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

import { assertSafeProviderBaseUrl } from "./url-safety.js";
import type {
  ListModelsFailureKind,
  ListModelsResult,
} from "./merge-models.js";
import { fetchProviderHttp } from "./provider-transport.js";

export type { ListModelsFailureKind, ListModelsResult };

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
  assertSafeProviderBaseUrl(input.baseUrl);
  const headers: Record<string, string> = {};
  if (input.apiKey?.trim()) headers.Authorization = `Bearer ${input.apiKey.trim()}`;

  let res: Response;
  try {
    // R7: share Host-only provider transport with smoke / inference paths.
    res = await fetchProviderHttp(input.baseUrl, "/models", {
      method: "GET",
      headers,
      timeoutMs,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : String(error);
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, kind: "timeout", ids: [], detail: `拉取模型列表超时（${Math.round(timeoutMs / 1000)}s）` };
    }
    if (
      /private|reserved|local|loopback|redirect/i.test(message)
    ) {
      return {
        ok: false,
        kind: "network",
        ids: [],
        detail: `模型列表被安全策略拒绝：${message.slice(0, 120)}`,
      };
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

// ── 合并：browser-safe pure helpers live in merge-models.ts (R11). ──
// Re-export for Host callers that historically imported from models.ts.
export {
  mergeModels,
  type MergedModel,
} from "./merge-models.js";
