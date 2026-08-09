/**
 * 目录自校准（catalog refresh）— 机制优先于数据。
 *
 * 对每个模型档案：host 进程内能解析出 key → 实拉 `GET {baseUrl}/models`，
 * 把实时模型列表与校准时间写进覆盖层（overlay.ts，yaml 种子永为兜底）；
 * 解析不出 key → 如实报告「配置后可校准」，绝不静默跳过。
 *
 * 档案 → 目录计费模式的匹配是确定性的：
 *   1. profile.provider 命中目录供应商 → 在该供应商内按 base_url 匹配计费模式
 *      （匹配不到退回 default_billing，注记）；
 *   2. provider 不在目录（如内建 glm、自定义端点）→ 跨全部供应商按 base_url
 *      匹配；都不中 → not-in-catalog（自定义端点本就无种子可校准）。
 *
 * 全部失败分类降级（auth/network/endpoint/timeout），绝不抛——刷新是维护
 * 动作，不是硬依赖。
 */

import type { ModelProfile } from "@penglai/protocol";
import {
  CATALOG,
  getProvider,
  type ProviderCatalogDoc,
} from "./catalog.js";
import {
  listRemoteModels as listRemoteModelsImpl,
  type ListModelsFailureKind,
  type ListModelsResult,
} from "./models.js";
import type { CatalogOverlayEntry } from "./overlay.js";

export type RefreshStatus =
  | "refreshed"
  | "no-key"
  | "not-in-catalog"
  | ListModelsFailureKind;

export interface RefreshRow {
  profileId: string;
  label: string;
  providerId: string | null;
  billingId: string | null;
  status: RefreshStatus;
  /** 校准成功的实时模型数（未成功为 0）。 */
  count: number;
  checkedAt: number | null;
  /** 人类可读一行（中文）。 */
  detail: string;
}

export interface RefreshReport {
  rows: RefreshRow[];
  /** 本次成功校准的档案数。 */
  refreshed: number;
  /** 有 key 但校准失败（auth/network/…）的档案数。 */
  failed: number;
  /** 无 key / 不在目录而跳过的档案数。 */
  skipped: number;
}

export interface RefreshDeps {
  listProfiles: () => readonly ModelProfile[];
  resolveApiKey: (profile: ModelProfile) => string;
  saveEntry: (entry: CatalogOverlayEntry) => void;
  listRemoteModels?: (input: {
    baseUrl: string;
    apiKey?: string;
    timeoutMs?: number;
  }) => Promise<ListModelsResult>;
  catalog?: ProviderCatalogDoc;
  now?: () => number;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** 在目录里为档案找 (providerId, billingId)；找不到返回 null。 */
export function matchCatalogBilling(
  profile: ModelProfile,
  catalog: ProviderCatalogDoc = CATALOG,
): { providerId: string; billingId: string; note: string } | null {
  const base = normalizeUrl(profile.baseUrl);
  // "custom" 是目录里的特殊条目（自定义端点占位），不是真实供应商——
  // 自定义档案只走跨供应商 baseUrl 匹配，绝不按 default_billing 错配。
  const provider =
    profile.provider === "custom" ? undefined : getProvider(profile.provider, catalog);
  if (provider) {
    for (const [bid, mode] of Object.entries(provider.billing)) {
      if (mode.base_url && normalizeUrl(mode.base_url) === base) {
        return { providerId: profile.provider, billingId: bid, note: "" };
      }
    }
    return {
      providerId: profile.provider,
      billingId: provider.default_billing,
      note: "端点与目录模式不完全匹配，按默认计费模式校准",
    };
  }
  // provider 不在目录（内建 glm/grok/openai、自定义端点）：跨供应商按端点匹配。
  for (const [pid, entry] of Object.entries(catalog.providers)) {
    if (pid === "custom") continue;
    for (const [bid, mode] of Object.entries(entry.billing)) {
      if (mode.base_url && normalizeUrl(mode.base_url) === base) {
        return { providerId: pid, billingId: bid, note: `按端点匹配到目录供应商 ${pid}` };
      }
    }
  }
  return null;
}

/** 对全部档案跑一遍校准；任何单档案失败都不影响其余档案。 */
export async function refreshCatalog(deps: RefreshDeps): Promise<RefreshReport> {
  const listRemote = deps.listRemoteModels ?? listRemoteModelsImpl;
  const now = deps.now ?? Date.now;
  const catalog = deps.catalog ?? CATALOG;
  const rows: RefreshRow[] = [];

  for (const profile of deps.listProfiles()) {
    const match = matchCatalogBilling(profile, catalog);
    if (!match) {
      rows.push({
        profileId: profile.id,
        label: profile.label,
        providerId: null,
        billingId: null,
        status: "not-in-catalog",
        count: 0,
        checkedAt: null,
        detail: "不在供应商目录内（自定义端点无种子可校准；实时列表在对话/向导时生效）",
      });
      continue;
    }
    const key = deps.resolveApiKey(profile).trim();
    if (!key) {
      rows.push({
        profileId: profile.id,
        label: profile.label,
        providerId: match.providerId,
        billingId: match.billingId,
        status: "no-key",
        count: 0,
        checkedAt: null,
        detail: "未配置 key——配置后可校准（penglai setup / config add）",
      });
      continue;
    }
    const result = await listRemote({
      baseUrl: profile.baseUrl,
      apiKey: key,
      timeoutMs: 10_000,
    });
    if (!result.ok) {
      rows.push({
        profileId: profile.id,
        label: profile.label,
        providerId: match.providerId,
        billingId: match.billingId,
        status: result.kind as ListModelsFailureKind,
        count: 0,
        checkedAt: null,
        detail: result.detail,
      });
      continue;
    }
    const entry: CatalogOverlayEntry = {
      providerId: match.providerId,
      billingId: match.billingId,
      baseUrl: profile.baseUrl,
      modelIds: result.ids,
      checkedAt: now(),
    };
    deps.saveEntry(entry);
    rows.push({
      profileId: profile.id,
      label: profile.label,
      providerId: match.providerId,
      billingId: match.billingId,
      status: "refreshed",
      count: result.ids.length,
      checkedAt: entry.checkedAt,
      detail: match.note
        ? `已校准 ${result.ids.length} 个模型（${match.note}）`
        : `已校准 ${result.ids.length} 个模型`,
    });
  }

  return {
    rows,
    refreshed: rows.filter((r) => r.status === "refreshed").length,
    failed: rows.filter(
      (r) => !["refreshed", "no-key", "not-in-catalog"].includes(r.status),
    ).length,
    skipped: rows.filter((r) => r.status === "no-key" || r.status === "not-in-catalog")
      .length,
  };
}
