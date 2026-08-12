/**
 * 桌面首次启动向导的状态机（纯函数，UI 无关）。
 *
 * 顶层流程（真人装软件的自然顺序，不可跳步）：
 *
 *   welcome
 *     → provider（选厂家）
 *     → billing（选接入方式：按量 / Coding Plan / Agent Plan / Token Plan…）
 *     → model（在该接入方式下选模型）
 *     → key（填 Key → 冒烟 → 保存）
 *     → context（可选：授权个人资料目录）
 *     → identity
 *
 *   自定义端点：provider(custom) → customBase → customKey → customModel → context
 *
 * 架构纪律：
 *   - 壳（SetupWizard 底栏）统一「上一步 | 下一步」并排；步骤只提供内容与
 *     可否前进，不各自塞一套按钮（避免长列表把「下一步」顶出视口）。
 *   - **计费/套餐步不可跳过**：即使用户所选厂家只有一种模式，也要明示
 *     「按量 / 套餐」与端点、条款警示——这是 0.3 实测里最容易踩坑的面
 *     （Coding Plan 端点与按量不通用、条款限编码工具）。
 *   - 模型列表三级降级（实时 → 校准缓存 → 纯目录）；deprecated 不自动替换；
 *     key 支持 env: 引用。异步 RPC 在 SetupWizard.tsx。
 */

import {
  billingIds,
  checkDeprecated,
  defaultModelOf,
  getBilling,
  getProvider,
  mergeModels,
  modelsOf,
  orderedProviders,
  calibrationLine,
  overlayEntryFor,
  type BillingMode,
  type CatalogOverlayEntry,
  type ListModelsResult,
  type MergedModel,
  type ProviderCatalogDoc,
} from "./catalog.js";

// ── 步骤与选择 ─────────────────────────────────────────────────

export type WizardStepId =
  | "welcome"
  | "provider"
  | "billing"
  | "model"
  | "key"
  | "context"
  | "identity"
  | "customBase"
  | "customKey"
  | "customModel";

export interface KeyAnswer {
  /** 字面 key（env: 引用时为空）。 */
  apiKey: string;
  /** env: 引用的变量名（字面 key 时为空）。 */
  apiKeyEnv: string;
}

export interface WizardSelections {
  providerId: string;
  billingId: string;
  modelId: string;
  /** 计费模式自带或自定义手填的 base_url。 */
  baseUrl: string;
  /** 自定义端点的档案 id。 */
  customProfileId: string;
  /** 自定义路径在选模型之前填的 key。 */
  key: KeyAnswer | null;
}

export interface WizardNav {
  step: WizardStepId;
  selections: WizardSelections;
}

export function initialWizardNav(): WizardNav {
  return {
    step: "welcome",
    selections: {
      providerId: "",
      billingId: "",
      modelId: "",
      baseUrl: "",
      customProfileId: "custom",
      key: null,
    },
  };
}

// ── 推进 ───────────────────────────────────────────────────────

/** welcome → provider。 */
export function advanceFromWelcome(nav: WizardNav): WizardNav {
  return nav.step === "welcome" ? { ...nav, step: "provider" } : nav;
}

/**
 * 选定供应商：custom → customBase；其余一律进入 billing
 * （预选 default_billing，单模式也停留在计费页做明示确认）。
 */
export function pickProvider(
  nav: WizardNav,
  providerId: string,
  catalog: ProviderCatalogDoc,
): WizardNav {
  if (nav.step !== "provider") return nav;
  const entry = getProvider(providerId, catalog);
  if (!entry) return nav;
  const selections: WizardSelections = {
    ...nav.selections,
    providerId,
    billingId: entry.default_billing,
    modelId: "",
    baseUrl: "",
  };
  if (providerId === "custom") return { step: "customBase", selections };
  return { step: "billing", selections };
}

/**
 * 选定计费模式 → model。baseUrlOverride：模式无 OpenAI 兼容端点（如仅
 * Anthropic 协议）时 owner 手填的端点；缺省用模式自带 base_url。
 */
export function pickBilling(
  nav: WizardNav,
  billingId: string,
  catalog: ProviderCatalogDoc,
  baseUrlOverride?: string,
): WizardNav {
  if (nav.step !== "billing") return nav;
  const mode = getBilling(nav.selections.providerId, billingId, catalog);
  if (!mode) return nav;
  return {
    step: "model",
    selections: {
      ...nav.selections,
      billingId,
      baseUrl: baseUrlOverride?.trim() || mode.base_url,
    },
  };
}

/** 选定模型 → key。 */
export function pickModel(nav: WizardNav, modelId: string): WizardNav {
  if (nav.step !== "model" || !modelId.trim()) return nav;
  return {
    step: "key",
    selections: { ...nav.selections, modelId: modelId.trim() },
  };
}

/** 自定义端点：base URL（须 http(s)）+ 档案 id → customKey。 */
export function pickCustomBase(
  nav: WizardNav,
  baseUrl: string,
  profileId: string,
): WizardNav | { error: string } {
  if (nav.step !== "customBase") return nav;
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { return { error: "base URL 不是合法 URL。" }; }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    return { error: "公网模型端点必须使用 HTTPS；HTTP 仅允许 localhost/127.0.0.1/::1。" };
  }
  if (parsed.username || parsed.password || parsed.hash) {
    return { error: "base URL 不能包含凭证或片段。" };
  }
  return {
    step: "customKey",
    selections: {
      ...nav.selections,
      baseUrl: trimmed,
      customProfileId: profileId.trim() || "custom",
    },
  };
}

/** 自定义端点：key（本地端点可填任意非空占位）→ customModel。 */
export function pickCustomKey(nav: WizardNav, key: KeyAnswer): WizardNav {
  if (nav.step !== "customKey") return nav;
  return { step: "customModel", selections: { ...nav.selections, key } };
}

/** 自定义端点：选定模型（原地冒烟在组件内驱动）。 */
export function pickCustomModel(nav: WizardNav, modelId: string): WizardNav {
  if (nav.step !== "customModel" || !modelId.trim()) return nav;
  return { ...nav, selections: { ...nav.selections, modelId: modelId.trim() } };
}

/** 档案保存成功 → 个人上下文（可跳过）→ 身份诞生。 */
export function confirmSaved(nav: WizardNav): WizardNav {
  return { ...nav, step: "context" };
}

/** 跳过或完成个人上下文步 → 身份诞生。 */
export function advanceFromContext(nav: WizardNav): WizardNav {
  return nav.step === "context" ? { ...nav, step: "identity" } : nav;
}

// ── 返回上一步 ─────────────────────────────────────────────────

/** 每步的返回目标；welcome/identity 无返回（原地）。 */
export function backTarget(
  step: WizardStepId,
  _selections: WizardSelections,
  _catalog: ProviderCatalogDoc,
): WizardStepId {
  switch (step) {
    case "provider":
      return "welcome";
    case "billing":
      return "provider";
    case "model":
      // 计费步永不跳过 → 模型永远回到 billing
      return "billing";
    case "key":
      return "model";
    case "customBase":
      return "provider";
    case "customKey":
      return "customBase";
    case "customModel":
      return "customKey";
    case "context":
      // After standard key save or custom-model save.
      return _selections.providerId === "custom" ? "customModel" : "key";
    default:
      return step; // welcome / identity
  }
}

/**
 * 壳底栏导航模型：步骤只声明能否前进 / 主按钮文案，
 * 真正的「上一步 | 下一步」并排由 SetupWizard 壳渲染。
 */
export type WizardChromeKind =
  | "none" // welcome / identity 自带 CTA
  | "nav" // 标准 上一步 | 下一步
  | "busy"; // 冒烟进行中：只显示上一步，主按钮禁用

export interface WizardChrome {
  kind: WizardChromeKind;
  /** 是否显示「上一步」。 */
  showBack: boolean;
  /** 主按钮文案（kind=nav/busy）。 */
  primaryLabel: string;
  /** 主按钮是否可点。 */
  primaryEnabled: boolean;
}

/** 标准选择步（provider/billing/model/customBase/customKey）的壳状态。 */
export function selectionChrome(options: {
  step: WizardStepId;
  canProceed: boolean;
  primaryLabel?: string;
}): WizardChrome {
  const showBack =
    options.step !== "welcome" &&
    options.step !== "identity" &&
    options.step !== "context";
  return {
    kind: "nav",
    showBack,
    primaryLabel: options.primaryLabel ?? "下一步",
    primaryEnabled: options.canProceed,
  };
}

export function goBack(nav: WizardNav, catalog: ProviderCatalogDoc): WizardNav {
  return { ...nav, step: backTarget(nav.step, nav.selections, catalog) };
}

// ── 模型列表三级降级（实时 → 校准缓存 → 纯目录） ────────────────

export interface ModelListInput {
  catalog: ProviderCatalogDoc;
  providerId: string;
  billingId: string;
  /** config.listModels 无 key 探测结果。 */
  probe: ListModelsResult;
  /** catalog.status 的覆盖层（null = 不可用）。 */
  overlay: readonly CatalogOverlayEntry[] | null;
  now?: number;
}

export interface ResolvedModelList {
  merged: MergedModel[];
  /** 校准状态行（「已知模型 N 个 · 校准于 …」或未校准提示）。 */
  statusLine: string;
  /** 实时探测结果行（成功 N 个 / 降级原因）。 */
  probeLine: string;
  /** 实时不可用但用了上次校准缓存。 */
  usedOverlayCache: boolean;
}

export function resolveModelList(input: ModelListInput): ResolvedModelList {
  const calibrated = input.overlay
    ? overlayEntryFor(input.overlay, input.providerId, input.billingId)
    : undefined;
  const calLine = calibrationLine(calibrated, input.now ?? Date.now());
  const statusLine = calLine ?? "未校准 · 配好 key 后 `penglai catalog refresh` 可实时校准";
  const catalogModels = modelsOf(input.providerId, input.billingId, input.catalog);
  if (input.probe.ok) {
    return {
      merged: mergeModels(catalogModels, input.probe.ids),
      statusLine,
      probeLine: `${input.probe.detail}（实时优先，目录价格/特性按 id 补充）`,
      usedOverlayCache: false,
    };
  }
  if (calibrated && calibrated.modelIds.length > 0) {
    return {
      merged: mergeModels(catalogModels, calibrated.modelIds),
      statusLine,
      probeLine: `${input.probe.detail} · 实时列表不可用，改用上次校准缓存`,
      usedOverlayCache: true,
    };
  }
  return {
    merged: mergeModels(catalogModels, []),
    statusLine,
    probeLine: input.probe.detail,
    usedOverlayCache: false,
  };
}

/** 默认模型在合并列表中的下标（无则 0）。 */
export function defaultModelIndex(
  merged: readonly MergedModel[],
  catalog: ProviderCatalogDoc,
  providerId: string,
  billingId: string,
): number {
  const defaultId = defaultModelOf(providerId, billingId, catalog);
  return Math.max(0, merged.findIndex((m) => m.id === defaultId));
}

/** deprecated 提示（不自动替换；owner 显式确认后才换，与 CLI 的 Y/n 同语义）。 */
export function deprecatedNotice(
  catalog: ProviderCatalogDoc,
  providerId: string,
  modelId: string,
): { replace: string; text: string } | null {
  const dep = checkDeprecated(providerId, modelId, catalog);
  if (!dep) return null;
  const deadline = dep.deadline ? `，${dep.deadline} 停服` : "";
  return {
    replace: dep.replace,
    text: `${modelId} 已列入废弃表${deadline}，官方建议改用 ${dep.replace}`,
  };
}

// ── key 解析（env: 引用） ──────────────────────────────────────

const ENV_REF_PREFIX = "env:";

/** 各供应商惯用 key 环境变量（仅提示用；未列出的按 <ID>_API_KEY 猜）。 */
const ENV_HINT: Record<string, string> = {
  deepseek: "DEEPSEEK_API_KEY",
  volcengine: "ARK_API_KEY",
  bailian: "DASHSCOPE_API_KEY",
  zhipu: "ZHIPUAI_API_KEY",
  minimax: "MINIMAX_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  hunyuan: "HUNYUAN_API_KEY",
};

/**
 * 计费/套餐步的产品说明：告诉真人「这一档能不能当常驻管家用」。
 * 目录 warning 仍是权威；这里是向导层统一话术。
 */
export function billingGuidance(
  billingId: string,
  mode: BillingMode | undefined,
): { kind: "recommended" | "caution" | "blocked"; title: string; body: string } {
  if (billingId === "paygo" || billingId === "payg") {
    return {
      kind: "recommended",
      title: "推荐：按量 OpenAI 兼容",
      body: "任意 OpenAI 兼容 /chat/completions 端点 + Key，适合常驻管家。端点与 Key 与套餐通常不通用。",
    };
  }
  if (billingId === "coding_plan") {
    return {
      kind: "caution",
      title: "Coding Plan · 慎用于管家",
      body:
        "专属编码端点 + 官方条款多限 Claude Code / Cursor 等交互编码工具；与按量 base_url/Key 往往不通用。" +
        (mode?.warning ? ` 厂商说明：${mode.warning}` : " 蓬莱常驻请优先选「按量付费」。"),
    };
  }
  if (billingId === "agent_plan") {
    return {
      kind: "caution",
      title: "Agent Plan · 专属端点",
      body:
        "智能体套餐通常走独立 base_url 与积分/配额体系，与按量不互通。" +
        (mode?.warning ? ` 厂商说明：${mode.warning}` : " 接入前请确认 OpenAI 兼容与自动化条款。"),
    };
  }
  if (billingId === "token_plan") {
    return {
      kind: "caution",
      title: "Token / 订阅 Plan",
      body:
        "订阅档常有独立域名或自动化禁令。" +
        (mode?.warning ? ` 厂商说明：${mode.warning}` : " 若条款禁止常驻 API，请改用按量。"),
    };
  }
  if (mode && !mode.base_url) {
    return {
      kind: "blocked",
      title: "无 OpenAI 兼容端点",
      body: "该模式未提供 OpenAI 兼容 base_url（可能仅 Anthropic 协议或封闭工具白名单）。需手填兼容网关，或改选按量。",
    };
  }
  return {
    kind: "recommended",
    title: mode?.label ?? billingId,
    body: mode?.note ?? "请确认端点与 Key 适用于 OpenAI 兼容调用。",
  };
}

export function envHintFor(providerId: string): string {
  return ENV_HINT[providerId] ?? `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

/** 解析 key 输入：字面 key 或 env:变量名 引用；空/非法 → null。 */
export function parseKeyAnswer(raw: string): KeyAnswer | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.toLowerCase().startsWith(ENV_REF_PREFIX)) {
    const envName = trimmed.slice(ENV_REF_PREFIX.length).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) return null;
    return { apiKey: "", apiKeyEnv: envName };
  }
  return { apiKey: trimmed, apiKeyEnv: "" };
}

// ── 档案 id / label 规则（与 CLI 一致） ─────────────────────────

export function profileIdFor(selections: WizardSelections, catalog: ProviderCatalogDoc): string {
  if (selections.providerId === "custom") return selections.customProfileId || "custom";
  const provider = getProvider(selections.providerId, catalog);
  if (provider && selections.billingId !== provider.default_billing) {
    return `${selections.providerId}-${selections.billingId}`;
  }
  return selections.providerId;
}

export function labelFor(selections: WizardSelections, catalog: ProviderCatalogDoc): string {
  if (selections.providerId === "custom") return `${selections.modelId} @ ${selections.baseUrl}`;
  const provider = getProvider(selections.providerId, catalog);
  if (!provider) return selections.providerId;
  const billings = Object.keys(provider.billing);
  if (billings.length > 1) {
    return `${provider.display}（${provider.billing[selections.billingId]?.label ?? selections.billingId}）`;
  }
  return provider.display;
}

// ── 冒烟失败菜单（CLI 0.3.x 体验的三选一） ─────────────────────

export type SmokeFailureAction = "retry" | "changeModel" | "skip";

export const SMOKE_SKIP_WARNING =
  "跳过验证：档案会照常保存，但首次对话可能直接报模型错误；" +
  "修好 key 或端点后可在设置页重新配置模型，或在 CLI 跑 `penglai setup`。";

// ── 步骤进度（页眉指示） ────────────────────────────────────────

/** 步骤进度（welcome/identity 返回 null 不显示）；自定义路径与 CLI 页码一致。 */
export function stepProgress(
  step: WizardStepId,
  customSmoking: boolean,
): { index: number; total: number; label: string } | null {
  switch (step) {
    case "provider":
      return { index: 1, total: 4, label: "选择供应商" };
    case "billing":
      return { index: 2, total: 4, label: "选择计费模式" };
    case "model":
      return { index: 3, total: 4, label: "选择模型" };
    case "key":
      return { index: 4, total: 4, label: "填入 Key 并验证" };
    case "customBase":
      return { index: 2, total: 4, label: "自定义端点" };
    case "customKey":
      return { index: 3, total: 4, label: "填入 Key" };
    case "customModel":
      return customSmoking
        ? { index: 4, total: 4, label: "冒烟验证" }
        : { index: 3, total: 4, label: "选择模型" };
    case "context":
      return { index: 5, total: 5, label: "个人上下文（可选）" };
    default:
      return null;
  }
}

// ── 供应商/计费/模型的展示派生 ──────────────────────────────────

export interface ProviderRow {
  id: string;
  display: string;
  signupUrl: string;
  billingTags: string;
  defaultModel: string;
  isCustom: boolean;
  billingCount: number;
}

/** 供应商选择页行数据（向导顺序，custom 语义特殊）。 */
export function providerRows(catalog: ProviderCatalogDoc): ProviderRow[] {
  return orderedProviders(catalog).map(({ id, entry }) => {
    const tags = Object.entries(entry.billing)
      .map(([bid, mode]) => shortTag(bid, mode))
      .join(" / ");
    return {
      id,
      display: entry.display,
      signupUrl: entry.signup_url,
      billingTags: id === "custom" ? "自己的 OpenAI 兼容服务" : tags,
      defaultModel: id === "custom" ? "" : defaultModelOf(id, undefined, catalog),
      isCustom: id === "custom",
      billingCount: Object.keys(entry.billing).length,
    };
  });
}

function shortTag(billingId: string, mode: BillingMode): string {
  const known: Record<string, string> = {
    paygo: "按量",
    coding_plan: "Coding",
    agent_plan: "Agent",
    token_plan: "订阅",
  };
  return known[billingId] ?? (mode.label ?? billingId).split("（")[0];
}

/** 计费模式行数据。 */
export function billingRows(
  catalog: ProviderCatalogDoc,
  providerId: string,
): Array<{ id: string; mode: BillingMode }> {
  return billingIds(providerId, catalog).map((id) => ({
    id,
    mode: getBilling(providerId, id, catalog)!,
  }));
}
