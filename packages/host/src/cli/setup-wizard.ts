/**
 * 首次运行向导（onboarding 一等公民）— 0.3.x 翻页式向导的 TS 移植 + 实时模型列表。
 *
 * 页面流（每步清屏 + 迷你 banner，非 tty 降级顺序文本；全程中文）：
 *
 *   欢迎（全 banner）
 *   → 步骤 1/4 选供应商（按目录 wizard_order，display + 计费模式说明）
 *   → 步骤 2/4 选计费模式（多模式供应商；单模式展示摘要，回车继续）
 *   → 步骤 3/4 选模型（先探测 GET /models 实时列表：成功则实时优先合并
 *      目录价格/特性，失败降级纯目录；default 高亮即默认值；手输已废弃
 *      模型会提示替换建议与死线）
 *   → 步骤 4/4 填 key（不回显，env: 引用支持）→ 冒烟验证（带 key 复核
 *      实时列表）→ 保存（0600）→ 进 chat
 *
 *   自定义端点走简化路径：base_url → 档案 id → key → /models 尝试 →
 *   选模型/手输 → 冒烟 → 保存。
 *
 * 每个选择页可输 0 返回上一步；冒烟失败菜单保留 0.3.x 体验
 * （重输 key / 返回换模型 / 跳过验证先保存）。
 *
 * 向导核心 UI 无关：prompter / smoke / listModels / saveProfile / pager /
 * catalog 全部是注入 seam（测试 mock；生产 readline + host RPC）。
 */

import * as readline from "node:readline";
import type { SmokeResult } from "../model-smoke.js";
import {
  CATALOG,
  billingIds,
  billingShortTag,
  catalogUpdated,
  checkDeprecated,
  defaultModelOf,
  describeModelContext,
  describeModelPrice,
  getBilling,
  getProvider,
  modelById,
  modelsOf,
  orderedProviders,
  type BillingMode,
  type ProviderCatalogDoc,
  type ProviderEntry,
} from "../providers/catalog.js";
import {
  listRemoteModels,
  mergeModels,
  type ListModelsResult,
  type MergedModel,
} from "../providers/models.js";
import { assertSafeProviderBaseUrl } from "../providers/url-safety.js";
import {
  calibrationLine,
  overlayEntryFor,
  type CatalogOverlayEntry,
} from "../providers/overlay.js";
import { createPager, padDisplay, type Pager } from "./pager.js";
import type { CliIO } from "./format.js";

// ── injectable seams ───────────────────────────────────────────

/** Prompt seam: every interaction is mockable in tests. */
export interface WizardPrompter {
  /** Visible answer (menu choice, model id, base URL). */
  ask(question: string): Promise<string>;
  /** Secret answer, no terminal echo (API key). */
  askSecret(question: string): Promise<string>;
}

export interface WizardSmokeInput {
  baseUrl: string;
  model: string;
  /** Literal key the owner typed ("" when using an env reference). */
  apiKey: string;
  /** Env var name when the owner chose an env reference ("" otherwise). */
  apiKeyEnv: string;
}

export interface WizardProfileInput extends WizardSmokeInput {
  id: string;
  label: string;
  provider: string;
}

/** 实时模型列表 seam（生产：host RPC；测试：mock）。 */
export type WizardListModels = (input: {
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
}) => Promise<ListModelsResult>;

export interface WizardDeps {
  io: CliIO;
  prompter: WizardPrompter;
  /** One-shot smoke call (host RPC in production). */
  smoke: (input: WizardSmokeInput) => Promise<SmokeResult>;
  /** Persist the profile (host RPC → profiles.json 0600 in production). */
  saveProfile: (input: WizardProfileInput) => Promise<unknown>;
  /** Penglai data dir, for the "where did my key land" line. */
  dataDir: string;
  /** 实时模型列表（缺省：CLI 直连端点，无 key 探测）。 */
  listModels?: WizardListModels;
  /** 目录校准覆盖层（生产：host catalog.status RPC；测试：mock）。 */
  catalogOverlay?: () => Promise<CatalogOverlayEntry[] | null>;
  /** 翻页渲染器（缺省：按 io.tty + NO_COLOR 自建）。 */
  pager?: Pager;
  /** 供应商目录（缺省：内置生成的 2026-06-29 版）。 */
  catalog?: ProviderCatalogDoc;
}

export interface WizardResult {
  /** Saved profile id (null only when the owner bailed before saving). */
  profileId: string | null;
  /** The smoke test passed. */
  verified: boolean;
  /** The owner skipped verification after a failed smoke. */
  skipped: boolean;
}

// ── 常量与小工具 ────────────────────────────────────────────────

const ENV_REF_PREFIX = "env:";

/** 各供应商惯用 key 环境变量（仅提示用；未列出的按 <ID>_API_KEY 猜）。 */
const ENV_HINT: Record<string, string> = {
  deepseek: "DEEPSEEK_API_KEY",
  volcengine: "ARK_API_KEY",
  bailian: "DASHSCOPE_API_KEY",
  zhipu: "ZHIPUAI_API_KEY",
  minimax: "MINIMAX_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  hunyuan: "HUNYUAN_API_KEY",
};

function envHintFor(providerId: string): string {
  return ENV_HINT[providerId] ?? `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

/** Parse a key answer: literal key, or `env:VAR_NAME` reference. */
function parseKeyAnswer(raw: string): { apiKey: string; apiKeyEnv: string } | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.toLowerCase().startsWith(ENV_REF_PREFIX)) {
    const envName = trimmed.slice(ENV_REF_PREFIX.length).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) return null;
    return { apiKey: "", apiKeyEnv: envName };
  }
  return { apiKey: trimmed, apiKeyEnv: "" };
}

// ── 向导状态机 ─────────────────────────────────────────────────

type StepId =
  | "welcome"
  | "provider"
  | "billing"
  | "model"
  | "key"
  | "customBase"
  | "customKey"
  | "customModel";

interface WizardState {
  providerId: string;
  billingId: string;
  modelId: string;
  /** 解析后的 base_url（计费模式自带或自定义手填）。 */
  baseUrl: string;
  /** 自定义端点的档案 id。 */
  profileId: string;
  /** 已输入的 key（自定义路径在选模型之前填 key）。 */
  key: { apiKey: string; apiKeyEnv: string } | null;
}

type StepOutcome = StepId | WizardResult;

function isResult(outcome: StepOutcome): outcome is WizardResult {
  return typeof outcome === "object";
}

export async function runSetupWizard(deps: WizardDeps): Promise<WizardResult> {
  const { io, prompter } = deps;
  const pager = deps.pager ?? createPager(io);
  const catalog = deps.catalog ?? CATALOG;
  const listModels: WizardListModels =
    deps.listModels ?? ((input) => listRemoteModels({ baseUrl: input.baseUrl, apiKey: input.apiKey }));
  const dim = (text: string) => pager.paint(text, "38;5;245");
  const accent = (text: string) => pager.paint(text, "1", "38;5;167");

  const state: WizardState = {
    providerId: "",
    billingId: "",
    modelId: "",
    baseUrl: "",
    profileId: "",
    key: null,
  };

  // ── 渲染/提问小助手 ──

  /** 0.3.x `ask`：› 提示符 + （回车=default）。 */
  async function ask(prompt: string, def = ""): Promise<string> {
    const tip = def ? dim(`（回车=${def}）`) : "";
    const answer = await prompter.ask(`  ${accent("›")} ${prompt}${tip}: `);
    return answer.trim() || def;
  }

  /**
   * 数字菜单："" = 默认项；allowBack 时 "0" = 返回上一步；
   * 其余非法输入重问。返回 0 基索引或 "back"。
   */
  async function askMenu(question: string, count: number, defaultIndex: number, allowBack: boolean): Promise<number | "back"> {
    const backTip = allowBack ? "，0=返回上一步" : "";
    for (;;) {
      const raw = (await prompter.ask(`  ${accent("›")} ${question} [1-${count}，默认 ${defaultIndex + 1}${backTip}]: `)).trim();
      if (raw === "") return defaultIndex;
      if (raw === "0" && allowBack) return "back";
      const picked = Number.parseInt(raw, 10);
      if (Number.isInteger(picked) && picked >= 1 && picked <= count) return picked - 1;
      io.line(`  无效序号，请输入 1 到 ${count}${allowBack ? "（0 返回上一步）" : ""}。`);
    }
  }

  // ── 页面 0：欢迎 ──

  async function stepWelcome(): Promise<StepId> {
    pager.banner();
    io.line("");
    io.line("  蓬莱第一次醒来。先花一分钟接上大脑：选供应商 → 选模型 → 填 key → 验活。");
    io.line(
      dim(
        `  目录数据 ${catalogUpdated(catalog)} 实测修正版 · ${orderedProviders(catalog).length - 1} 家供应商 + 自定义端点 · 选择页可输 0 返回上一步`,
      ),
    );
    await ask("回车开始");
    return "provider";
  }

  // ── 页面 1：选供应商 ──

  async function stepProvider(): Promise<StepOutcome> {
    pager.page(1, "选择供应商（蓬莱的大脑）");
    const rows = orderedProviders(catalog);
    rows.forEach(({ id, entry }, index) => {
      const num = accent(String(index + 1).padStart(2));
      if (id === "custom") {
        io.line(`  ${num}  ${padDisplay(entry.display, 24)}${dim("自己的 OpenAI 兼容服务")}`);
        return;
      }
      const tags = Object.keys(entry.billing)
        .map((bid) => billingShortTag(bid, entry.billing[bid]))
        .join(" / ");
      const defModel = defaultModelOf(id, undefined, catalog);
      io.line(
        `  ${num}  ${padDisplay(entry.display, 30)}${padDisplay(tags, 24)}${dim(defModel)}`,
      );
    });
    io.line("");
    io.line(dim("  选中后给出注册入口与计费说明；价格单位：元/百万 tokens。"));
    const picked = await askMenu("选择供应商", rows.length, 0, true);
    if (picked === "back") return "welcome";
    const { id, entry } = rows[picked];
    state.providerId = id;
    if (id === "custom") return "customBase";
    if (entry.signup_url) {
      io.line(`  ${dim("注册/充值入口：")}${pager.paint(entry.signup_url, "38;5;37")}`);
    }
    const billings = billingIds(id, catalog);
    state.billingId = entry.default_billing;
    if (billings.length === 1) {
      // 单计费模式：摘要页，回车继续（0 返回）。
      const mode = getBilling(id, undefined, catalog)!;
      pager.page(2, `计费模式（${entry.display}）`);
      renderBillingDetail(mode);
      const go = await ask("计费模式唯一，回车采用（0 返回上一步）");
      if (go === "0") return "provider";
      state.baseUrl = mode.base_url;
      return "model";
    }
    return "billing";
  }

  function renderBillingDetail(mode: BillingMode): void {
    io.line(`  ${accent("计费")}  ${mode.label}`);
    if (mode.base_url) io.line(`  ${accent("端点")}  ${mode.base_url}`);
    if (mode.base_url_anthropic) io.line(`  ${accent("备查")}  ${mode.base_url_anthropic} ${dim("（Anthropic 协议）")}`);
    if (mode.note) io.line(`  ${dim(mode.note)}`);
    if (mode.plans && mode.plans.length > 0) {
      io.line(`  ${accent("档位")}`);
      for (const plan of mode.plans) {
        io.line(`     · ${padDisplay(plan.display, 26)}${dim(plan.desc ?? "")}`);
      }
    }
  }

  // ── 页面 2：选计费模式（多模式供应商） ──

  async function stepBilling(): Promise<StepOutcome> {
    const provider = getProvider(state.providerId, catalog) as ProviderEntry;
    pager.page(2, `选择计费模式（${provider.display}）`);
    const ids = billingIds(state.providerId, catalog);
    ids.forEach((bid, index) => {
      const mode = provider.billing[bid];
      const num = accent(String(index + 1).padStart(2));
      const plans = mode.plans?.length
        ? dim(`（${mode.plans.map((p) => p.display).join(" · ")}）`)
        : "";
      io.line(`  ${num}  ${mode.label} ${plans}`);
      if (mode.note) io.line(`       ${dim(mode.note)}`);
    });
    const defaultIndex = Math.max(0, ids.indexOf(provider.default_billing));
    const picked = await askMenu("选择计费模式", ids.length, defaultIndex, true);
    if (picked === "back") return "provider";
    state.billingId = ids[picked];
    const mode = provider.billing[state.billingId];
    if (mode.warning) io.line(`  ⚠️  ${mode.warning}`);
    if (mode.plans?.length) {
      for (const plan of mode.plans) {
        io.line(`     · ${padDisplay(plan.display, 26)}${dim(plan.desc ?? "")}`);
      }
    }
    if (!mode.base_url) {
      // 目录端点为空（如 Kimi 套餐仅 Anthropic 协议）：手填或返回。
      io.line(`  ${dim("该模式无 OpenAI 兼容端点，可手填或输 0 返回换模式。")}`);
      const manual = await ask("API Base URL（如 https://api.example.com/v1；0 返回）");
      if (manual === "0") return "billing";
      state.baseUrl = manual.trim();
    } else {
      state.baseUrl = mode.base_url;
    }
    return "model";
  }

  // ── 页面 3：选模型（实时列表 / 目录合并） ──

  async function stepModel(): Promise<StepOutcome> {
    const provider = getProvider(state.providerId, catalog) as ProviderEntry;
    const mode = getBilling(state.providerId, state.billingId, catalog) as BillingMode;
    pager.page(3, `选择模型（${provider.display} · ${mode.label}）`);

    // 探测实时模型列表（无 key；401/失败 → 纯目录降级）。
    if (pager.paged) io.out(`  ${dim("正在拉取实时模型列表…")}`);
    const probe = await listModels({ baseUrl: state.baseUrl });
    if (pager.paged) io.out("\r" + " ".repeat(30) + "\r");
    // 校准覆盖层状态行（三层新鲜度 L3）：refresh 落盘的持久新鲜度记录。
    const overlay = deps.catalogOverlay
      ? await deps.catalogOverlay().catch(() => null)
      : null;
    const calibrated = overlay
      ? overlayEntryFor(overlay, state.providerId, state.billingId)
      : undefined;
    const calLine = calibrationLine(calibrated);
    io.line(
      dim(
        calLine
          ? `  ${calLine}`
          : "  未校准 · 配好 key 后 `penglai catalog refresh` 可实时校准",
      ),
    );
    const catalogModels = modelsOf(state.providerId, state.billingId, catalog);
    let merged: MergedModel[];
    if (probe.ok) {
      io.line(dim(`  ${probe.detail}（实时优先，目录价格/特性按 id 补充）`));
      merged = mergeModels(catalogModels, probe.ids);
    } else if (calibrated && calibrated.modelIds.length > 0) {
      // 实时探测不可用但校准记录在：用校准缓存（仍是观测数据，带时间戳）。
      io.line(dim(`  ${probe.detail}`));
      io.line(dim(`  实时列表不可用，改用上次校准缓存（${calLine}）`));
      merged = mergeModels(catalogModels, calibrated.modelIds);
    } else {
      io.line(dim(`  ${probe.detail}`));
      merged = mergeModels(catalogModels, []);
    }

    merged.forEach((model, index) => {
      const num = accent(String(index + 1).padStart(2));
      const name = padDisplay(model.display, 34);
      const price = model.catalog ? describeModelPrice(model.catalog) : "";
      const ctx = model.catalog ? describeModelContext(model.catalog) : "";
      const feats = model.catalog?.features?.join("/") ?? "";
      const meta = [price, ctx, feats].filter(Boolean).join(" · ");
      const tags: string[] = [];
      if (model.isDefault) tags.push(pager.paint("★默认", "38;5;172"));
      if (model.source === "live") tags.push(dim("（实时新增）"));
      if (model.source === "catalog" && probe.ok) tags.push(dim("（目录）"));
      io.line(`  ${num}  ${name}${dim(meta)} ${tags.join(" ")}`.trimEnd());
    });

    // 选择：序号 / 回车=默认 / 手输模型 id / 0 返回。
    const defaultId = defaultModelOf(state.providerId, state.billingId, catalog);
    const defaultIndex = Math.max(0, merged.findIndex((m) => m.id === defaultId));
    for (;;) {
      const raw = (
        await prompter.ask(
          `  ${accent("›")} 选择模型 [1-${merged.length}，默认 ${defaultIndex + 1}，可手输模型 id，0 返回上一步]: `,
        )
      ).trim();
      let chosen = "";
      if (raw === "") chosen = merged[defaultIndex]?.id ?? "";
      else if (raw === "0") return provider.billing[state.billingId] && billingIds(state.providerId, catalog).length > 1 ? "billing" : "provider";
      else if (/^\d+$/.test(raw)) {
        const idx = Number.parseInt(raw, 10) - 1;
        if (idx >= 0 && idx < merged.length) chosen = merged[idx].id;
        else {
          io.line(`  无效序号，请输入 1 到 ${merged.length}。`);
          continue;
        }
      } else chosen = raw; // 手输模型 id（实时列表/目录之外也允许）

      // deprecated 替换表：提示替换建议与死线（0.3.x 体验）。
      const dep = checkDeprecated(state.providerId, chosen, catalog);
      if (dep) {
        const deadline = dep.deadline ? `，${dep.deadline} 停服` : "";
        io.line(`  ⚠️  ${chosen} 已列入废弃表${deadline}，官方建议改用 ${dep.replace}`);
        const swap = (await ask(`改用 ${dep.replace}？[Y/n]`, "y")).toLowerCase();
        if (swap.startsWith("y") || swap === "") chosen = dep.replace;
      }
      state.modelId = chosen;
      return "key";
    }
  }

  // ── 页面 4：填 key + 冒烟验证 ──

  async function stepKey(): Promise<StepOutcome> {
    const provider = getProvider(state.providerId, catalog) as ProviderEntry;
    const mode = getBilling(state.providerId, state.billingId, catalog) as BillingMode;
    pager.page(4, "填入 Key 并验证");
    io.line(`  ${accent("已选")}  ${provider.display} · ${mode.label}`);
    io.line(`  ${accent("端点")}  ${state.baseUrl}`);
    if (mode.base_url_anthropic) io.line(`  ${accent("备查")}  ${mode.base_url_anthropic} ${dim("（Anthropic 协议端点）")}`);
    const modelEntry = modelById(state.providerId, state.billingId, state.modelId, catalog);
    io.line(`  ${accent("模型")}  ${state.modelId}${modelEntry ? dim(`（${modelEntry.display}）`) : ""}`);
    io.line("");

    const envHint = envHintFor(state.providerId);
    for (;;) {
      const secret = await prompter.askSecret(
        `  ${accent("›")} API key（输入不回显；也可输入 env:变量名 引用环境变量，如 env:${envHint}；0 返回换模型）: `,
      );
      const trimmed = secret.trim();
      if (trimmed === "0") return "model";
      const key = parseKeyAnswer(trimmed);
      if (!key) {
        io.line(`  key 不能为空；引用环境变量请写成 env:变量名（如 env:${envHint}）。`);
        continue;
      }

      io.line("  冒烟验证：真实调用一次模型（30s 超时）…");
      const smokeInput: WizardSmokeInput = { baseUrl: state.baseUrl, model: state.modelId, ...key };
      const result = await deps.smoke(smokeInput);
      if (result.ok) {
        io.line(`  ✓ ${result.detail}`);
        await confirmLiveList(state.baseUrl, state.modelId, key);
        const saved = await persist(smokeInput, profileIdFor(state, catalog), labelFor(state, catalog));
        return { profileId: saved, verified: true, skipped: false };
      }

      // 分类失败 → 0.3.x 失败菜单（重输 / 返回换模型 / 跳过先存）。
      io.line(`  ✗ ${result.detail}`);
      for (;;) {
        const action = (
          await prompter.ask(`  ${accent("›")} 怎么办？[1=重输 key / 2=返回换模型 / 3=跳过验证先保存]: `)
        ).trim();
        if (action === "" || action === "1") break; // 内层循环：重输 key
        if (action === "2") return "model";
        if (action === "3") {
          io.line(
            "  ⚠ 跳过验证：档案会照常保存，但首次对话可能直接报模型错误；" +
              "修好 key 或端点后可用 `penglai setup` 重来。",
          );
          const saved = await persist(smokeInput, profileIdFor(state, catalog), labelFor(state, catalog));
          return { profileId: saved, verified: false, skipped: true };
        }
        io.line("  输入 1、2 或 3。");
      }
    }
  }

  /** 冒烟通过后的实时列表复核（带 key）：确认所选模型在列。 */
  async function confirmLiveList(
    baseUrl: string,
    modelId: string,
    key: { apiKey: string; apiKeyEnv: string },
  ): Promise<void> {
    const live = await listModels({ baseUrl, apiKey: key.apiKey, apiKeyEnv: key.apiKeyEnv });
    if (live.ok) {
      if (live.ids.includes(modelId)) {
        io.line(`  ✓ 模型「${modelId}」已在供应商实时列表确认（共 ${live.ids.length} 个模型）`);
      } else {
        io.line(`  ⚠ 实时列表中未见「${modelId}」（目录/路由模型；冒烟已通过，可正常使用）`);
      }
    } else {
      io.line(dim(`  实时列表复核不可用：${live.detail}`));
    }
  }

  // ── 自定义端点简化路径 ──

  async function stepCustomBase(): Promise<StepOutcome> {
    pager.page(2, "自定义 OpenAI 兼容端点");
    io.line(dim("  任何兼容 OpenAI /chat/completions 的端点均可（本地 vLLM/Ollama/自建网关…）。"));
    const base = await ask("API Base URL（通常以 /v1 结尾；0 返回）");
    if (base === "0") return "provider";
    try {
      state.baseUrl = assertSafeProviderBaseUrl(base);
    } catch (error) {
      io.line(`  ${error instanceof Error ? error.message : String(error)}`);
      return "customBase";
    }
    const id = await ask("档案 id", "custom");
    state.profileId = id || "custom";
    return "customKey";
  }

  async function stepCustomKey(): Promise<StepOutcome> {
    pager.page(3, "填入 Key（自定义端点）");
    io.line(`  ${accent("端点")}  ${state.baseUrl}`);
    for (;;) {
      const secret = await prompter.askSecret(
        `  ${accent("›")} API key（输入不回显；本地端点可填任意非空占位；env:变量名 亦可；0 返回）: `,
      );
      const trimmed = secret.trim();
      if (trimmed === "0") return "customBase";
      const key = parseKeyAnswer(trimmed);
      if (!key) {
        io.line("  key 不能为空（本地无鉴权端点也请填占位，如 sk-local）。");
        continue;
      }
      state.key = key;
      return "customModel";
    }
  }

  async function stepCustomModel(): Promise<StepOutcome> {
    pager.page(3, "选择模型（自定义端点）");
    const key = state.key as { apiKey: string; apiKeyEnv: string };
    if (pager.paged) io.out(`  ${dim("正在拉取实时模型列表…")}`);
    const probe = await listModels({ baseUrl: state.baseUrl, apiKey: key.apiKey, apiKeyEnv: key.apiKeyEnv });
    if (pager.paged) io.out("\r" + " ".repeat(30) + "\r");
    if (probe.ok) {
      io.line(dim(`  ${probe.detail}`));
      probe.ids.forEach((id, index) => {
        io.line(`  ${accent(String(index + 1).padStart(2))}  ${id}`);
      });
      for (;;) {
        const raw = (
          await prompter.ask(
            `  ${accent("›")} 选择模型 [1-${probe.ids.length}，可手输模型 id，0 返回]: `,
          )
        ).trim();
        if (raw === "0") return "customKey";
        if (/^\d+$/.test(raw)) {
          const idx = Number.parseInt(raw, 10) - 1;
          if (idx >= 0 && idx < probe.ids.length) {
            state.modelId = probe.ids[idx];
            break;
          }
          io.line(`  无效序号，请输入 1 到 ${probe.ids.length}。`);
          continue;
        }
        if (raw) {
          state.modelId = raw;
          break;
        }
        io.line("  请输入序号或模型 id。");
      }
    } else {
      io.line(dim(`  ${probe.detail}`));
      const manual = await ask("模型名（0 返回）");
      if (manual === "0") return "customKey";
      state.modelId = manual;
    }
    // 冒烟（含失败菜单）。
    pager.page(4, "冒烟验证（自定义端点）");
    io.line(`  ${accent("端点")}  ${state.baseUrl}`);
    io.line(`  ${accent("模型")}  ${state.modelId}`);
    io.line("");
    for (;;) {
      io.line("  冒烟验证：真实调用一次模型（30s 超时）…");
      const smokeInput: WizardSmokeInput = { baseUrl: state.baseUrl, model: state.modelId, ...key };
      const result = await deps.smoke(smokeInput);
      if (result.ok) {
        io.line(`  ✓ ${result.detail}`);
        const saved = await persist(smokeInput, state.profileId, `${state.modelId} @ ${state.baseUrl}`);
        return { profileId: saved, verified: true, skipped: false };
      }
      io.line(`  ✗ ${result.detail}`);
      for (;;) {
        const action = (
          await prompter.ask(`  ${accent("›")} 怎么办？[1=重输 key / 2=返回换模型 / 3=跳过验证先保存]: `)
        ).trim();
        if (action === "" || action === "1") return "customKey";
        if (action === "2") break; // 留在本页换模型
        if (action === "3") {
          io.line(
            "  ⚠ 跳过验证：档案会照常保存，但首次对话可能直接报模型错误；" +
              "修好 key 或端点后可用 `penglai setup` 重来。",
          );
          const saved = await persist(smokeInput, state.profileId, `${state.modelId} @ ${state.baseUrl}`);
          return { profileId: saved, verified: false, skipped: true };
        }
        io.line("  输入 1、2 或 3。");
      }
      // action === "2": 重新渲染模型选择（重新拉列表）。
      return "customModel";
    }
  }

  // ── 保存 ──

  async function persist(smokeInput: WizardSmokeInput, id: string, label: string): Promise<string> {
    await deps.saveProfile({ id, label, provider: state.providerId, ...smokeInput });
    io.line(`  档案已保存：${id}（${smokeInput.model} @ ${smokeInput.baseUrl}）`);
    io.line(
      smokeInput.apiKeyEnv
        ? `  key 走环境变量 ${smokeInput.apiKeyEnv}（本机不留存 key 本体）`
        : `  key 存于 ${deps.dataDir}/profiles.json（0600 私密文件）`,
    );
    return id;
  }

  // ── 状态机主循环（每步返回下一个页面 id；返回即重渲染目标页） ──

  const steps: Record<StepId, () => Promise<StepOutcome>> = {
    welcome: stepWelcome,
    provider: stepProvider,
    billing: stepBilling,
    model: stepModel,
    key: stepKey,
    customBase: stepCustomBase,
    customKey: stepCustomKey,
    customModel: stepCustomModel,
  };

  let step: StepId = "welcome";
  for (;;) {
    const outcome: StepOutcome = await steps[step]();
    if (isResult(outcome)) return outcome;
    step = outcome;
  }
}

// ── 档案 id / label 规则 ───────────────────────────────────────

function profileIdFor(state: WizardState, catalog: ProviderCatalogDoc): string {
  if (state.providerId === "custom") return state.profileId || "custom";
  const provider = getProvider(state.providerId, catalog);
  if (provider && state.billingId !== provider.default_billing) {
    return `${state.providerId}-${state.billingId}`;
  }
  return state.providerId;
}

function labelFor(state: WizardState, catalog: ProviderCatalogDoc): string {
  if (state.providerId === "custom") return `${state.modelId} @ ${state.baseUrl}`;
  const provider = getProvider(state.providerId, catalog);
  if (!provider) return state.providerId;
  const billings = Object.keys(provider.billing);
  if (billings.length > 1) {
    return `${provider.display}（${billingShortTag(state.billingId, provider.billing[state.billingId])}）`;
  }
  return provider.display;
}

// ── production readline prompter ───────────────────────────────

export interface ReadlinePrompter extends WizardPrompter {
  close(): void;
}

/**
 * The production prompter: readline over stdin/stdout. Secrets are never
 * echoed (readline's _writeToOutput is muted for the duration of the
 * answer) — the terminal shows nothing, not even asterisks.
 */
export function createReadlinePrompter(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): ReadlinePrompter {
  const rl = readline.createInterface({
    input,
    output,
    terminal: (input as NodeJS.ReadStream).isTTY === true,
  });
  let muted = false;
  const anyRl = rl as unknown as {
    _writeToOutput?: (chunk: string, encoding: BufferEncoding, cb?: () => void) => void;
  };
  const originalWrite = anyRl._writeToOutput?.bind(rl);
  if (originalWrite) {
    anyRl._writeToOutput = (chunk, encoding, cb) => {
      if (muted) {
        if (typeof cb === "function") cb();
        return; // 不回显
      }
      originalWrite(chunk, encoding, cb);
    };
  }
  return {
    ask(question) {
      return new Promise((resolve) => {
        muted = false;
        rl.question(question, (answer) => resolve(answer));
      });
    },
    askSecret(question) {
      return new Promise((resolve) => {
        muted = false;
        // rl.question writes the prompt synchronously; mute only the answer.
        rl.question(question, (answer) => {
          muted = false;
          output.write("\n");
          resolve(answer);
        });
        muted = true;
      });
    },
    close() {
      rl.close();
    },
  };
}
