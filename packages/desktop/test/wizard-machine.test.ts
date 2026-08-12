/**
 * 桌面首次启动向导状态机测试（纯函数，无 DOM 无 RPC）。
 *
 * 钉死四类行为：步骤推进（厂家→计费必经→模型→Key、自定义路径）、
 * 返回上一步（model 恒回 billing）、模型列表三级降级
 * （实时 → 校准缓存 → 纯目录）、冒烟跳过的档案推导；外加 deprecated 提示、
 * env: key 解析、档案 id/label 规则、真实目录 sanity（11 家含 OpenAI/xAI + custom）。
 * RPC 时序与渲染在 SetupWizard.tsx，由 owner dogfood 与官网截图流水线覆盖。
 */

import { describe, expect, it } from "vitest";
import {
  CATALOG,
  type ListModelsResult,
  type ProviderCatalogDoc,
} from "../src/wizard/catalog.js";
import {
  SMOKE_SKIP_WARNING,
  backTarget,
  advanceFromContext,
  confirmSaved,
  defaultModelIndex,
  deprecatedNotice,
  envHintFor,
  goBack,
  initialWizardNav,
  labelFor,
  parseKeyAnswer,
  pickBilling,
  pickCustomBase,
  pickCustomKey,
  pickCustomModel,
  pickModel,
  pickProvider,
  profileIdFor,
  providerRows,
  resolveModelList,
  billingGuidance,
  selectionChrome,
  stepProgress,
  type WizardNav,
} from "../src/wizard/machine.js";

// ── fixture 目录（小而全：单模式/多模式/无端点模式/deprecated/custom） ──

const FIXTURE: ProviderCatalogDoc = {
  updated: "2026-01-01",
  currency: "CNY",
  wizard_order: ["alpha", "beta", "custom"],
  providers: {
    alpha: {
      display: "Alpha",
      signup_url: "https://alpha.example.com",
      default_billing: "paygo",
      default_model: "alpha-lite",
      billing: {
        paygo: {
          label: "按量付费",
          base_url: "https://api.alpha.com/v1",
          models: [
            { id: "alpha-lite", display: "Alpha Lite", input_cny: 1, output_cny: 2, context_k: 128, default: true },
            { id: "alpha-pro", display: "Alpha Pro", input_cny: 8, output_cny: 16, context_k: 256, features: ["工具"] },
          ],
        },
      },
      deprecated: [{ id: "alpha-old", replace: "alpha-lite", deadline: "2026-08-01" }],
    },
    beta: {
      display: "Beta",
      signup_url: "",
      default_billing: "paygo",
      default_model: "beta-1",
      billing: {
        paygo: {
          label: "按量付费",
          base_url: "https://api.beta.com/v1",
          models: [{ id: "beta-1", display: "Beta 1", default: true }],
        },
        plan: {
          label: "套餐（仅 Anthropic 协议）",
          base_url: "",
          base_url_anthropic: "https://api.beta.com/anthropic",
          models: [{ id: "beta-1", display: "Beta 1" }],
        },
      },
    },
    custom: {
      display: "自定义端点",
      signup_url: "",
      default_billing: "paygo",
      default_model: "",
      billing: { paygo: { label: "按量付费", base_url: "", models: [] } },
    },
  },
};

function navAt(step: WizardNav["step"], patch: Partial<WizardNav["selections"]> = {}): WizardNav {
  const nav = initialWizardNav();
  return { step, selections: { ...nav.selections, ...patch } };
}

const probeOk: ListModelsResult = { ok: true, kind: "ok", ids: ["alpha-new-live", "alpha-lite"], detail: "实时模型列表：2 个模型" };
const probeAuth: ListModelsResult = { ok: false, kind: "auth", ids: [], detail: "模型列表需要鉴权（展示内置目录）" };

// ── 推进 ───────────────────────────────────────────────────────

describe("步骤推进", () => {
  it("happy path：welcome → provider → billing → model → key → context → identity", () => {
    let nav = initialWizardNav();
    expect(nav.step).toBe("welcome");
    nav = { ...nav, step: "provider" };
    nav = pickProvider(nav, "beta", FIXTURE);
    expect(nav.step).toBe("billing"); // 多模式进计费页
    expect(nav.selections.billingId).toBe("paygo"); // 预选 default
    nav = pickBilling(nav, "paygo", FIXTURE);
    expect(nav.step).toBe("model");
    expect(nav.selections.baseUrl).toBe("https://api.beta.com/v1");
    nav = pickModel(nav, "beta-1");
    expect(nav.step).toBe("key");
    expect(nav.selections.modelId).toBe("beta-1");
    nav = confirmSaved(nav);
    expect(nav.step).toBe("context");
    nav = advanceFromContext(nav);
    expect(nav.step).toBe("identity");
  });

  it("单计费模式也进入 billing 明示确认（不跳步）", () => {
    let nav = navAt("provider");
    nav = pickProvider(nav, "alpha", FIXTURE);
    expect(nav.step).toBe("billing");
    expect(nav.selections.billingId).toBe("paygo");
    nav = pickBilling(nav, "paygo", FIXTURE);
    expect(nav.step).toBe("model");
    expect(nav.selections.baseUrl).toBe("https://api.alpha.com/v1");
  });

  it("无 OpenAI 兼容端点的模式：手填 base URL 才推进", () => {
    let nav = navAt("provider");
    nav = pickProvider(nav, "beta", FIXTURE);
    nav = pickBilling(nav, "plan", FIXTURE, "https://gateway.example.com/v1");
    expect(nav.step).toBe("model");
    expect(nav.selections.baseUrl).toBe("https://gateway.example.com/v1");
  });

  it("自定义路径：provider(custom) → customBase → customKey → customModel", () => {
    let nav = navAt("provider");
    nav = pickProvider(nav, "custom", FIXTURE);
    expect(nav.step).toBe("customBase");
    const based = pickCustomBase(nav, " http://127.0.0.1:8000/v1/ ", "local");
    expect(based).not.toHaveProperty("error");
    nav = based as WizardNav;
    expect(nav.step).toBe("customKey");
    expect(nav.selections.baseUrl).toBe("http://127.0.0.1:8000/v1"); // 去尾斜杠
    expect(nav.selections.customProfileId).toBe("local");
    nav = pickCustomKey(nav, { apiKey: "placeholder", apiKeyEnv: "" });
    expect(nav.step).toBe("customModel");
    nav = pickCustomModel(nav, "my-model");
    expect(nav.selections.modelId).toBe("my-model");
    nav = confirmSaved(nav);
    expect(nav.step).toBe("context");
    expect(backTarget("context", nav.selections, FIXTURE)).toBe("customModel");
    nav = advanceFromContext(nav);
    expect(nav.step).toBe("identity");
  });

  it("非法 base URL 返回 error 不换步", () => {
    const nav = navAt("customBase", { providerId: "custom" });
    const result = pickCustomBase(nav, "ftp://x", "");
    expect(result).toHaveProperty("error");
  });

  it("空档案 id 兜底 custom；非法步骤的推进调用是 no-op", () => {
    const nav = navAt("customBase", { providerId: "custom" });
    const based = pickCustomBase(nav, "http://localhost:11434/v1", "  ") as WizardNav;
    expect(based.selections.customProfileId).toBe("custom");
    // 在 welcome 步调 pickProvider 不应换步
    expect(pickProvider(initialWizardNav(), "alpha", FIXTURE).step).toBe("welcome");
  });

  it("公网明文模型端点会被拒绝，避免 API key 裸传", () => {
    const nav = navAt("customBase", { providerId: "custom" });
    expect(pickCustomBase(nav, "http://api.example.com/v1", "relay")).toHaveProperty("error");
    expect(pickCustomBase(nav, "http://localhost.example.com/v1", "relay")).toHaveProperty("error");
  });
});

// ── 返回上一步 ─────────────────────────────────────────────────

describe("返回上一步", () => {
  it("每步的返回目标（model 恒回 billing）", () => {
    expect(backTarget("provider", navAt("provider").selections, FIXTURE)).toBe("welcome");
    expect(backTarget("billing", navAt("billing", { providerId: "beta" }).selections, FIXTURE)).toBe("provider");
    // 计费步永不跳过：model 永远回到 billing
    expect(backTarget("model", navAt("model", { providerId: "beta" }).selections, FIXTURE)).toBe("billing");
    expect(backTarget("model", navAt("model", { providerId: "alpha" }).selections, FIXTURE)).toBe("billing");
    expect(backTarget("key", navAt("key", { providerId: "alpha" }).selections, FIXTURE)).toBe("model");
    expect(backTarget("customBase", navAt("customBase").selections, FIXTURE)).toBe("provider");
    expect(backTarget("customKey", navAt("customKey").selections, FIXTURE)).toBe("customBase");
    expect(backTarget("customModel", navAt("customModel").selections, FIXTURE)).toBe("customKey");
    // welcome / identity 无返回
    expect(backTarget("welcome", navAt("welcome").selections, FIXTURE)).toBe("welcome");
    expect(backTarget("identity", navAt("identity").selections, FIXTURE)).toBe("identity");
  });

  it("goBack 保留已选内容（回来不丢上下文）", () => {
    let nav = navAt("key", { providerId: "beta", billingId: "paygo", modelId: "beta-1", baseUrl: "https://api.beta.com/v1" });
    nav = goBack(nav, FIXTURE);
    expect(nav.step).toBe("model");
    expect(nav.selections.modelId).toBe("beta-1");
    nav = goBack(nav, FIXTURE);
    expect(nav.step).toBe("billing");
    expect(nav.selections.providerId).toBe("beta");
  });
});

// ── 模型列表三级降级 ────────────────────────────────────────────

describe("模型列表降级", () => {
  const NOW = 1_800_000_000_000;

  it("实时探测成功：实时优先合并，目录价格按 id 补充", () => {
    const resolved = resolveModelList({
      catalog: FIXTURE,
      providerId: "alpha",
      billingId: "paygo",
      probe: probeOk,
      overlay: null,
      now: NOW,
    });
    expect(resolved.usedOverlayCache).toBe(false);
    expect(resolved.probeLine).toContain("实时优先");
    // 实时列表顺序优先：alpha-new-live 在前
    expect(resolved.merged.map((m) => m.id)).toEqual(["alpha-new-live", "alpha-lite", "alpha-pro"]);
    // 目录价格/特性按 id 补充
    const lite = resolved.merged.find((m) => m.id === "alpha-lite");
    expect(lite?.catalog?.input_cny).toBe(1);
    expect(lite?.source).toBe("both");
    expect(resolved.merged[0].source).toBe("live");
    expect(resolved.statusLine).toContain("未校准");
  });

  it("实时失败 + 校准缓存在：改用上次校准缓存（带时间戳）", () => {
    const resolved = resolveModelList({
      catalog: FIXTURE,
      providerId: "alpha",
      billingId: "paygo",
      probe: probeAuth,
      overlay: [
        {
          providerId: "alpha",
          billingId: "paygo",
          baseUrl: "https://api.alpha.com/v1",
          modelIds: ["alpha-calibrated"],
          checkedAt: NOW - 2 * 3_600_000,
        },
      ],
      now: NOW,
    });
    expect(resolved.usedOverlayCache).toBe(true);
    expect(resolved.statusLine).toBe("已知模型 1 个 · 校准于 2 小时前");
    expect(resolved.merged.map((m) => m.id)).toEqual(["alpha-calibrated", "alpha-lite", "alpha-pro"]);
  });

  it("实时失败 + 无校准：纯目录兜底", () => {
    const resolved = resolveModelList({
      catalog: FIXTURE,
      providerId: "alpha",
      billingId: "paygo",
      probe: probeAuth,
      overlay: [],
      now: NOW,
    });
    expect(resolved.usedOverlayCache).toBe(false);
    expect(resolved.probeLine).toBe(probeAuth.detail);
    expect(resolved.merged.map((m) => m.id)).toEqual(["alpha-lite", "alpha-pro"]);
    expect(resolved.merged.every((m) => m.source === "catalog")).toBe(true);
  });

  it("默认模型下标：命中 default 高亮；缺失时 0", () => {
    const merged = resolveModelList({
      catalog: FIXTURE, providerId: "alpha", billingId: "paygo",
      probe: probeAuth, overlay: null, now: NOW,
    }).merged;
    expect(defaultModelIndex(merged, FIXTURE, "alpha", "paygo")).toBe(0); // alpha-lite default
    const liveFirst = resolveModelList({
      catalog: FIXTURE, providerId: "alpha", billingId: "paygo",
      probe: probeOk, overlay: null, now: NOW,
    }).merged;
    expect(defaultModelIndex(liveFirst, FIXTURE, "alpha", "paygo")).toBe(1);
  });
});

// ── deprecated 与跳过 ──────────────────────────────────────────

describe("deprecated 提示与冒烟跳过", () => {
  it("deprecated：返回替换建议与死线（不自动替换，owner 确认语义）", () => {
    const notice = deprecatedNotice(FIXTURE, "alpha", "alpha-old");
    expect(notice?.replace).toBe("alpha-lite");
    expect(notice?.text).toContain("2026-08-01 停服");
    expect(deprecatedNotice(FIXTURE, "alpha", "alpha-lite")).toBeNull();
    expect(deprecatedNotice(FIXTURE, "beta", "beta-1")).toBeNull();
  });

  it("跳过验证的档案推导不依赖冒烟结果（id/label 照常）", () => {
    const sel = navAt("key", {
      providerId: "beta", billingId: "plan", modelId: "beta-1",
      baseUrl: "https://gateway.example.com/v1",
    }).selections;
    expect(profileIdFor(sel, FIXTURE)).toBe("beta-plan"); // 非默认模式带模式后缀
    expect(labelFor(sel, FIXTURE)).toContain("Beta");
    expect(SMOKE_SKIP_WARNING).toContain("跳过验证");
    // 跳过冒烟后进入可选 context，再进 identity
    expect(confirmSaved(navAt("key")).step).toBe("context");
    expect(advanceFromContext(confirmSaved(navAt("key"))).step).toBe("identity");
  });
});

// ── key 解析与档案规则 ──────────────────────────────────────────

describe("key 解析（env: 引用）", () => {
  it("字面 key / env 引用 / 非法输入", () => {
    expect(parseKeyAnswer("  abc123 ")).toEqual({ apiKey: "abc123", apiKeyEnv: "" });
    expect(parseKeyAnswer("env:MY_KEY")).toEqual({ apiKey: "", apiKeyEnv: "MY_KEY" });
    expect(parseKeyAnswer("ENV:lower_ok_1")).toEqual({ apiKey: "", apiKeyEnv: "lower_ok_1" });
    expect(parseKeyAnswer("")).toBeNull();
    expect(parseKeyAnswer("env:")).toBeNull();
    expect(parseKeyAnswer("env:1BAD")).toBeNull();
    expect(parseKeyAnswer("env:BAD-NAME")).toBeNull();
  });

  it("env 提示：目录供应商用惯用变量名，未列出按 <ID>_API_KEY 猜", () => {
    expect(envHintFor("deepseek")).toBe("DEEPSEEK_API_KEY");
    expect(envHintFor("moonshot")).toBe("MOONSHOT_API_KEY");
    expect(envHintFor("hunyuan")).toBe("HUNYUAN_API_KEY");
  });

  it("档案 id / label：默认模式=provider id，非默认=provider-billing，custom=档案 id", () => {
    expect(profileIdFor(navAt("key", { providerId: "alpha", billingId: "paygo" }).selections, FIXTURE)).toBe("alpha");
    expect(profileIdFor(navAt("key", { providerId: "beta", billingId: "plan" }).selections, FIXTURE)).toBe("beta-plan");
    expect(profileIdFor(navAt("key", { providerId: "custom", customProfileId: "local" }).selections, FIXTURE)).toBe("local");
    expect(labelFor(navAt("key", { providerId: "alpha", billingId: "paygo" }).selections, FIXTURE)).toBe("Alpha");
    expect(labelFor(navAt("key", { providerId: "beta", billingId: "plan" }).selections, FIXTURE)).toContain("套餐");
    expect(labelFor(navAt("key", { providerId: "custom", modelId: "m", baseUrl: "http://x/v1" }).selections, FIXTURE)).toBe("m @ http://x/v1");
  });
});

// ── 进度与供应商行 ──────────────────────────────────────────────

describe("步骤进度与供应商行", () => {
  it("进度标签与 CLI 页码一致；welcome/identity 无进度", () => {
    expect(stepProgress("provider", false)).toEqual({ index: 1, total: 4, label: "选择供应商" });
    expect(stepProgress("billing", false)?.index).toBe(2);
    expect(stepProgress("model", false)?.index).toBe(3);
    expect(stepProgress("key", false)?.index).toBe(4);
    expect(stepProgress("customBase", false)?.index).toBe(2);
    expect(stepProgress("customModel", false)?.label).toBe("选择模型");
    expect(stepProgress("customModel", true)?.label).toBe("冒烟验证");
    expect(stepProgress("welcome", false)).toBeNull();
    expect(stepProgress("identity", false)).toBeNull();
    expect(stepProgress("context", false)).toEqual({
      index: 5,
      total: 5,
      label: "个人上下文（可选）",
    });
    expect(backTarget("context", navAt("key").selections, FIXTURE)).toBe("key");
  });

  it("供应商行：向导顺序 + 计费短标签 + 默认模型 + custom 语义", () => {
    const rows = providerRows(FIXTURE);
    expect(rows.map((r) => r.id)).toEqual(["alpha", "beta", "custom"]);
    expect(rows[0].billingTags).toBe("按量");
    expect(rows[0].defaultModel).toBe("alpha-lite");
    expect(rows[2].isCustom).toBe(true);
    expect(rows[2].billingTags).toContain("OpenAI 兼容");
  });
});

// ── 真实目录 sanity（与 CLI 同源） ──────────────────────────────

describe("真实目录（CATALOG 2026-07-28 实测修正版）", () => {
  it("10 家供应商 + custom，向导顺序与 CLI 一致", () => {
    const rows = providerRows(CATALOG);
    expect(rows).toHaveLength(11);
    expect(rows[0].id).toBe("deepseek");
    expect(rows.at(-1)?.id).toBe("custom");
    expect(rows.filter((r) => !r.isCustom)).toHaveLength(10);
  });

  it("真实目录：任意厂家（含 deepseek 单模式）都先进 billing，再选模型", () => {
    const ds = pickProvider(navAt("provider"), "deepseek", CATALOG);
    expect(ds.step).toBe("billing");
    expect(ds.selections.billingId).toBe("paygo");
    const vol = pickProvider(navAt("provider"), "volcengine", CATALOG);
    expect(vol.step).toBe("billing");
    // 返回目标同样分流
    expect(backTarget("model", vol.selections, CATALOG)).toBe("billing");
    expect(backTarget("model", navAt("model", { providerId: "deepseek" }).selections, CATALOG)).toBe("billing");
  });

  it("真实 deprecated：deepseek-chat → deepseek-v4-flash（死线 2026-07-24）", () => {
    const notice = deprecatedNotice(CATALOG, "deepseek", "deepseek-chat");
    expect(notice?.replace).toBe("deepseek-v4-flash");
    expect(notice?.text).toContain("2026-07-24 停服");
  });
});


describe("计费指引与壳导航", () => {
  it("paygo 推荐 / coding_plan 警示", () => {
    expect(billingGuidance("paygo", FIXTURE.providers.alpha.billing.paygo).kind).toBe("recommended");
    expect(billingGuidance("coding_plan", { label: "Coding", base_url: "https://x", models: [] }).kind).toBe("caution");
    expect(billingGuidance("plan", FIXTURE.providers.beta.billing.plan).kind).toBe("blocked");
  });

  it("selectionChrome：底栏可前进状态", () => {
    const chrome = selectionChrome({ step: "provider", canProceed: true, primaryLabel: "下一步" });
    expect(chrome.kind).toBe("nav");
    expect(chrome.showBack).toBe(true);
    expect(chrome.primaryEnabled).toBe(true);
  });
});
