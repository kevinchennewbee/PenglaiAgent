/**
 * 供应商目录移植保真度测试。
 *
 *   1. 全量保真：生成的 PROVIDER_CATALOG 与 Host 内的
 *      catalog.source.yaml
 *      逐字段深比较一致——一个字段都不许丢。
 *   2. 抽查 5 家供应商的关键字段（deepseek / volcengine / bailian /
 *      zhipu / hunyuan），显式钉死计费模式、双协议 base_url、价格、
 *      上下文、features、default、deprecated 替换表、wizard_order。
 *   3. 查询 API 行为（有序列表 / 按 id 取 / 取计费模式 / 取模型 /
 *      deprecated 检查）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { PROVIDER_CATALOG } from "../src/providers/catalog.generated.js";
import {
  CATALOG,
  billingIds,
  billingShortTag,
  catalogContextTokens,
  checkDeprecated,
  defaultModelOf,
  describeModelContext,
  describeModelPrice,
  findCatalogModel,
  getBilling,
  getProvider,
  modelById,
  modelsOf,
  orderedProviders,
  wizardOrder,
} from "../src/providers/catalog.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const YAML_PATH = path.join(REPO_ROOT, "packages/host/src/providers/catalog.source.yaml");

function yamlDoc(): Record<string, unknown> {
  return YAML.parse(fs.readFileSync(YAML_PATH, "utf-8")) as Record<string, unknown>;
}

// ── 1. 全量保真 ────────────────────────────────────────────────

describe("provider catalog: 与 yaml 全量保真", () => {
  it("生成目录与 yaml 深比较完全一致（全字段）", () => {
    // JSON 归一化两边（yaml 解析与 JSON.stringify 生成同构）。
    const fromYaml = JSON.parse(JSON.stringify(yamlDoc()));
    const fromGenerated = JSON.parse(JSON.stringify(PROVIDER_CATALOG));
    expect(fromGenerated).toEqual(fromYaml);
  });

  it("scripts/sync-catalog.mjs --check 认为产物与 yaml 同步", async () => {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(process.execPath, [path.join(REPO_ROOT, "scripts/sync-catalog.mjs"), "--check"], {
      encoding: "utf-8",
    });
    expect(out).toContain("同步");
  });

  it("wizard_order 含国内主流 + OpenAI/xAI，custom 收尾；目录供应商集合一致", () => {
    const doc = yamlDoc() as { wizard_order: string[]; providers: Record<string, unknown> };
    expect(wizardOrder()).toEqual(doc.wizard_order);
    expect(wizardOrder()).toHaveLength(11);
    expect(wizardOrder().at(-1)).toBe("custom");
    expect(wizardOrder()).toEqual(expect.arrayContaining(["openai", "xai", "deepseek", "moonshot"]));
    expect(Object.keys(CATALOG.providers).sort()).toEqual(
      Object.keys(doc.providers).sort(),
    );
  });
});

// ── 2. 五家抽查 ────────────────────────────────────────────────

describe("provider catalog: 五家供应商字段抽查", () => {
  it("deepseek：纯按量、双协议端点、缓存价、default、deprecated 死线", () => {
    const p = getProvider("deepseek")!;
    expect(p.display).toBe("DeepSeek");
    expect(p.signup_url).toBe("https://platform.deepseek.com");
    expect(p.default_billing).toBe("paygo");
    expect(billingIds("deepseek")).toEqual(["paygo"]);
    const paygo = getBilling("deepseek")!;
    expect(paygo.base_url).toBe("https://api.deepseek.com");
    expect(paygo.base_url_anthropic).toBe("https://api.deepseek.com/anthropic");
    expect(paygo.models).toHaveLength(2);
    const flash = paygo.models[0];
    expect(flash).toMatchObject({
      id: "deepseek-v4-flash",
      context_k: 1000,
      max_output_k: 384,
      input_cny: 1.0,
      input_cached_cny: 0.02,
      output_cny: 2.0,
      default: true,
    });
    expect(flash.features).toEqual(["thinking", "tools", "json_mode"]);
    expect(defaultModelOf("deepseek")).toBe("deepseek-v4-flash");
    // deprecated 替换表（含死线）。
    expect(p.deprecated).toHaveLength(2);
    expect(checkDeprecated("deepseek", "deepseek-chat")).toEqual({
      id: "deepseek-chat",
      replace: "deepseek-v4-flash",
      deadline: "2026-07-24",
    });
    expect(checkDeprecated("deepseek", "deepseek-reasoner")?.replace).toBe("deepseek-v4-flash");
    expect(checkDeprecated("deepseek", "deepseek-v4-flash")).toBeNull();
  });

  it("volcengine：三种计费模式、套餐档位、AFP 积分价、deprecated", () => {
    const p = getProvider("volcengine")!;
    expect(billingIds("volcengine")).toEqual(["paygo", "coding_plan", "agent_plan"]);
    expect(billingShortTag("coding_plan")).toBe("Coding");
    expect(billingShortTag("agent_plan")).toBe("Agent");
    const paygo = getBilling("volcengine", "paygo")!;
    expect(paygo.base_url).toBe("https://ark.cn-beijing.volces.com/api/v3");
    expect(paygo.models.map((m) => m.id)).toEqual([
      "doubao-seed-evolving",
      "doubao-seed-2.1-pro",
      "doubao-seed-2.1-turbo",
      "doubao-seed-2.0-pro",
      "doubao-seed-2.0-code",
      "doubao-seed-2.0-lite",
      "doubao-seed-2.0-mini",
    ]);
    expect(defaultModelOf("volcengine")).toBe("doubao-seed-evolving");
    const coding = getBilling("volcengine", "coding_plan")!;
    expect(coding.base_url).toBe("https://ark.cn-beijing.volces.com/api/coding/v3");
    expect(coding.warning).toContain("编码工具");
    expect(coding.plans?.map((pl) => [pl.id, pl.price_cny])).toEqual([
      ["lite", 40],
      ["pro", 200],
    ]);
    expect(defaultModelOf("volcengine", "coding_plan")).toBe("ark-code-latest");
    const agent = getBilling("volcengine", "agent_plan")!;
    expect(agent.base_url).toBe("https://ark.cn-beijing.volces.com/api/agent");
    expect(agent.plans).toHaveLength(4);
    expect(agent.plans?.[3]).toMatchObject({ id: "max", price_cny: 1000, afp_month: 500000 });
    const evolving = agent.models.find((m) => m.id === "doubao-seed-evolving")!;
    expect(evolving).toMatchObject({ afp_in: 2.5, afp_out: 2.5, default: true });
    expect(p.deprecated?.map((d) => [d.id, d.replace])).toEqual([
      ["doubao-seed-1.6", "doubao-seed-evolving"],
      ["doubao-seed-1.8", "doubao-seed-2.1-pro"],
      ["doubao-seed-2.0-lite", "doubao-seed-evolving"],
      ["deepseek-v3.2", "deepseek-v4-flash"],
    ]);
  });

  it("bailian：PAYG + Coding Plan、七模型、免费额度 note、套餐 warning", () => {
    const p = getProvider("bailian")!;
    expect(billingIds("bailian")).toEqual(["paygo", "coding_plan"]);
    const paygo = getBilling("bailian", "paygo")!;
    expect(paygo.base_url).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(paygo.base_url_anthropic).toBe("https://dashscope.aliyuncs.com/apps/anthropic");
    expect(paygo.note).toContain("100 万 token");
    expect(paygo.models).toHaveLength(9);
    expect(defaultModelOf("bailian")).toBe("qwen3.7-plus");
    const plus = modelById("bailian", "paygo", "qwen3.7-plus")!;
    expect(plus).toMatchObject({ context_k: 1000, input_cny: 2.0, output_cny: 8.0, default: true });
    expect(plus.features).toEqual(["thinking", "vision", "tools", "cache"]);
    const coding = getBilling("bailian", "coding_plan")!;
    expect(coding.warning).toContain("sk-sp-");
    expect(coding.plans).toEqual([
      expect.objectContaining({ id: "pro", price_cny: 200 }),
    ]);
  });

  it("zhipu：免费模型标记、双计费端点、GLM-5.2 默认", () => {
    const p = getProvider("zhipu")!;
    expect(billingIds("zhipu")).toEqual(["paygo", "coding_plan"]);
    const paygo = getBilling("zhipu", "paygo")!;
    expect(paygo.base_url).toBe("https://open.bigmodel.cn/api/paas/v4/");
    expect(paygo.models).toHaveLength(9);
    const free = paygo.models.filter((m) => m.free === true).map((m) => m.id);
    expect(free).toEqual(["glm-4.7-flash", "glm-4.6v-flash"]);
    const flash = modelById("zhipu", "paygo", "glm-4.7-flash")!;
    expect(flash).toMatchObject({ input_cny: 0, output_cny: 0, free: true });
    expect(defaultModelOf("zhipu")).toBe("glm-5.2");
    const coding = getBilling("zhipu", "coding_plan")!;
    expect(coding.base_url).toBe("https://open.bigmodel.cn/api/coding/paas/v4");
    expect(coding.plans?.map((pl) => pl.price_cny)).toEqual([49, 149, 469]);
  });

  it("hunyuan：hy3 正式版默认、preview 8/31 下线、订阅异域名端点", () => {
    const p = getProvider("hunyuan")!;
    expect(billingIds("hunyuan")).toEqual(["paygo", "token_plan"]);
    const paygo = getBilling("hunyuan", "paygo")!;
    expect(paygo.base_url).toBe("https://api.hunyuan.cloud.tencent.com/v1");
    expect(paygo.models.map((m) => m.id)).toEqual(["hy3", "hy3-preview"]);
    expect(defaultModelOf("hunyuan")).toBe("hy3");
    const token = getBilling("hunyuan", "token_plan")!;
    // 套餐专属端点（与按量不同域名！）
    expect(token.base_url).toBe("https://api.lkeap.cloud.tencent.com/plan/v3");
    expect(token.base_url_anthropic).toBe("https://api.lkeap.cloud.tencent.com/plan/anthropic");
    expect(token.plans).toHaveLength(4);
    expect(defaultModelOf("hunyuan", "token_plan")).toBe("tc-code-latest");
    expect(checkDeprecated("hunyuan", "hy3-preview")).toEqual({
      id: "hy3-preview",
      replace: "hy3",
      deadline: "2026-08-31",
    });
    expect(checkDeprecated("hunyuan", "hunyuan-turbos-latest")?.replace).toBe("hy3");
    expect(p.deprecated).toHaveLength(5);
  });
});

// ── 3. 查询 API ────────────────────────────────────────────────

describe("provider catalog: 查询 API", () => {
  it("orderedProviders 按 wizard_order 排列并携带条目", () => {
    const rows = orderedProviders();
    expect(rows.map((r) => r.id)).toEqual([
      "deepseek", "volcengine", "bailian", "zhipu", "minimax", "moonshot",
      "openai", "xai",
      "openrouter", "hunyuan", "custom",
    ]);
    expect(rows[0].entry.display).toBe("DeepSeek");
    expect(getProvider("openai")?.billing.paygo.base_url).toBe("https://api.openai.com/v1");
    expect(getProvider("xai")?.billing.paygo.base_url).toBe("https://api.x.ai/v1");
  });

  it("未知供应商/模式返回 undefined 与空列表，不抛", () => {
    expect(getProvider("nope")).toBeUndefined();
    expect(billingIds("nope")).toEqual([]);
    expect(getBilling("deepseek", "nope")).toBeUndefined();
    expect(modelsOf("nope")).toEqual([]);
    expect(defaultModelOf("nope")).toBe("");
    expect(checkDeprecated("nope", "x")).toBeNull();
  });

  it("moonshot 套餐端点为空串（仅 Anthropic 协议）保真保留", () => {
    const coding = getBilling("moonshot", "coding_plan")!;
    expect(coding.base_url).toBe("");
    expect(coding.base_url_anthropic).toBe("https://api.moonshot.cn/anthropic");
    expect(coding.warning).toContain("Anthropic");
  });

  it("openrouter 默认与混元/国际 slug 保真", () => {
    expect(defaultModelOf("openrouter")).toBe("anthropic/claude-sonnet-5");
    expect(modelById("openrouter", "paygo", "tencent/hy3")).toBeDefined();
    expect(modelById("openrouter", "paygo", "x-ai/grok-4.5")).toBeDefined();
    expect(modelById("openrouter", "paygo", "moonshotai/kimi-k3")).toBeDefined();
  });

  it("展示辅助：价格与上下文一句话", () => {
    const flash = modelById("deepseek", "paygo", "deepseek-v4-flash")!;
    expect(describeModelPrice(flash)).toContain("¥1");
    expect(describeModelPrice(flash)).toContain("缓存");
    expect(describeModelContext(flash)).toBe("1000K");
    const freeModel = modelById("zhipu", "paygo", "glm-4.7-flash")!;
    expect(describeModelPrice(freeModel)).toBe("免费");
    const grok = modelById("openrouter", "paygo", "x-ai/grok-4.5")!;
    expect(grok.features).toContain("thinking");
  });

  it("findCatalogModel prefers MiniMax-M3 entry with context_k (token_plan thin rows)", () => {
    // token_plan historically listed MiniMax-M3 without context_k; global lookup
    // must still surface the 1M paygo window so BYOK profiles don't go null.
    const hit = findCatalogModel("MiniMax-M3");
    expect(hit).not.toBeNull();
    expect(hit?.context_k).toBe(1000);
    expect(catalogContextTokens(hit)).toBe(1_000_000);
    const tokenPlan = modelById("minimax", "token_plan", "MiniMax-M3");
    expect(tokenPlan?.context_k).toBe(1000);
  });
});
