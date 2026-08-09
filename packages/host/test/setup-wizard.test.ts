/**
 * 首次运行向导测试（0.3.x 翻页式移植版）。
 *
 *   1. 单元流：脚本化 prompter + 脚本化 smoke/listModels seam，零 I/O——
 *      标准供应商全路径、多计费模式、返回上一步、deprecated 提示、
 *      /models 实时合并展示与降级、env: 引用、失败菜单、自定义端点。
 *   2. 翻页渲染：mock tty 断言清屏序列 + 迷你 banner；非 tty 降级顺序文本。
 *   3. runCli 端到端：裸 `penglai` 打真实 in-process host + mock 模型端点
 *      （冒烟与 /models 都是真实 HTTP 往返），以及非 tty 降级。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type StartedServer } from "../src/server.js";
import { _setPenglaiHomeForTest } from "../src/conversation-store.js";
import { MockModelServer } from "./fixtures/mock-model-server.js";
import { runCli } from "../src/cli/main.js";
import {
  runSetupWizard,
  type WizardDeps,
  type WizardPrompter,
} from "../src/cli/setup-wizard.js";
import { createPager } from "../src/cli/pager.js";
import { SETUP_NONTTY_GUIDANCE } from "../src/cli/commands.js";
import type { SmokeResult } from "../src/model-smoke.js";
import type { ListModelsResult } from "../src/providers/models.js";
import type { CliIO } from "../src/cli/format.js";

// ── test seams ─────────────────────────────────────────────────

function captureIo(tty = true): { io: CliIO; text: () => string } {
  let text = "";
  return {
    io: {
      out: (t) => {
        text += t;
      },
      line: (t) => {
        text += `${t}\n`;
      },
      err: (t) => {
        text += `${t}\n`;
      },
      tty,
    },
    text: () => text,
  };
}

function scriptedPrompter(answers: {
  ask?: string[];
  askSecret?: string[];
}): WizardPrompter {
  const askQueue = [...(answers.ask ?? [])];
  const secretQueue = [...(answers.askSecret ?? [])];
  return {
    ask: (q) => {
      const answer = askQueue.shift();
      if (answer === undefined) return Promise.reject(new Error(`unscripted ask: ${q}`));
      return Promise.resolve(answer);
    },
    askSecret: (q) => {
      const answer = secretQueue.shift();
      if (answer === undefined)
        return Promise.reject(new Error(`unscripted askSecret: ${q}`));
      return Promise.resolve(answer);
    },
  };
}

const OK_SMOKE: SmokeResult = { ok: true, kind: "ok", detail: "已连通（HTTP 200，12ms）", latencyMs: 12 };
const AUTH_SMOKE: SmokeResult = { ok: false, kind: "auth", detail: "API key 无效或被拒绝（HTTP 401）", latencyMs: 9 };

/** 默认 /models 探测失败（多数真实供应商无 key 401）→ 纯目录降级。 */
const AUTH_MODELS: ListModelsResult = {
  ok: false,
  kind: "auth",
  ids: [],
  detail: "模型列表需要鉴权（展示内置目录）",
};

function wizardDeps(overrides: Partial<WizardDeps> = {}): WizardDeps & {
  saved: Array<Record<string, unknown>>;
  io: CliIO;
  text: () => string;
} {
  const cap = captureIo(false); // 单测默认非 tty：输出断言不受转义码干扰
  const saved: Array<Record<string, unknown>> = [];
  return {
    io: cap.io,
    text: cap.text,
    saved,
    prompter: scriptedPrompter({}),
    smoke: async () => OK_SMOKE,
    listModels: async () => AUTH_MODELS,
    saveProfile: async (input) => {
      saved.push({ ...input });
    },
    dataDir: "/tmp/penglai-test-home",
    ...overrides,
  };
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

// ── 1. 标准供应商流程 ──────────────────────────────────────────

describe("setup wizard: 标准供应商流程（目录驱动）", () => {
  it("happy path：DeepSeek 默认值全回车 → 验活 → 保存", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "1", "", ""], // 欢迎回车 / 供应商 1 / 单计费模式回车 / 默认模型
        askSecret: ["sk-happy"],
      }),
    });
    const result = await runSetupWizard(deps);
    expect(result).toEqual({ profileId: "deepseek", verified: true, skipped: false });
    expect(deps.saved).toHaveLength(1);
    expect(deps.saved[0]).toMatchObject({
      id: "deepseek",
      label: "DeepSeek",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash", // 目录默认（不是过时的 deepseek-chat）
      apiKey: "sk-happy",
      apiKeyEnv: "",
    });
    const out = deps.text();
    expect(out).toContain("蓬莱第一次醒来");
    expect(out).toContain("步骤 1/4");
    expect(out).toContain("选择供应商");
    expect(out).toContain("步骤 4/4");
    expect(out).toContain("冒烟验证");
    expect(out).toContain("已连通");
    expect(out).toContain("档案已保存：deepseek");
    expect(out).toContain("profiles.json（0600");
    // 无 key 探测 401 → 目录降级说明在选模型页出现
    expect(out).toContain("模型列表需要鉴权");
  });

  it("供应商列表按 wizard_order 渲染并带计费模式说明", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "1", "", ""],
        askSecret: ["sk"],
      }),
    });
    await runSetupWizard(deps);
    const out = deps.text();
    expect(out).toContain("DeepSeek");
    expect(out).toContain("字节火山 Ark");
    expect(out).toContain("按量 / Coding / Agent"); // volcengine 三模式标签
    expect(out).toContain("Moonshot Kimi");
    expect(out).toContain("自定义 OpenAI 兼容端点");
    expect(out).toContain("注册/充值入口：https://platform.deepseek.com");
  });

  it("多计费模式：火山 Ark → Coding Plan → 默认 ark-code-latest", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "2", "2", ""], // 供应商 2 / 计费模式 2（Coding Plan）/ 默认模型
        askSecret: ["sk-ark"],
      }),
    });
    const result = await runSetupWizard(deps);
    expect(result.profileId).toBe("volcengine-coding_plan");
    expect(deps.saved[0]).toMatchObject({
      id: "volcengine-coding_plan",
      label: "字节火山 Ark（Coding）",
      baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
      model: "ark-code-latest",
    });
    const out = deps.text();
    expect(out).toContain("选择计费模式");
    expect(out).toContain("Coding Plan（编码套餐）");
    expect(out).toContain("仅限官方编码工具交互"); // warning
    expect(out).toContain("Lite ¥40/月");
  });

  it("返回上一步：计费模式页输 0 → 回到供应商页重选", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "2", "0", "1", "", ""], // 火山 → 计费页 0 返回 → DeepSeek → 摘要 → 默认模型
        askSecret: ["sk-x"],
      }),
    });
    const result = await runSetupWizard(deps);
    expect(result.profileId).toBe("deepseek");
    // 供应商页渲染了两次（第一次选火山，返回后重选 DeepSeek）
    expect(occurrences(deps.text(), "选择供应商（蓬莱的大脑）")).toBe(2);
  });

  it("供应商页输 0 → 回到欢迎页重新开始", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "0", "", "1", "", ""],
        askSecret: ["sk-x"],
      }),
    });
    const result = await runSetupWizard(deps);
    expect(result.profileId).toBe("deepseek");
    expect(occurrences(deps.text(), "蓬 莱 · 个人 AI 助理 0.4.0")).toBe(2); // 欢迎 banner ×2
  });

  it("key 页输 0 → 返回模型页换模型", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "1", "", "", "2"], // 默认模型 → key 页 0 返回 → 改选 2 号模型
        askSecret: ["0", "sk-second"], // 第一次 key 输 0（返回），第二次真 key
      }),
    });
    const result = await runSetupWizard(deps);
    expect(result.verified).toBe(true);
    expect(deps.saved[0]).toMatchObject({ model: "deepseek-v4-pro" });
  });
});

// ── 2. deprecated 替换表 ───────────────────────────────────────

describe("setup wizard: deprecated 模型提示", () => {
  it("手输已废弃模型 → 提示替换建议与死线 → 接受则换", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "1", "", "deepseek-chat", "y"],
        askSecret: ["sk"],
      }),
    });
    const result = await runSetupWizard(deps);
    expect(result.verified).toBe(true);
    const out = deps.text();
    expect(out).toContain("deepseek-chat 已列入废弃表");
    expect(out).toContain("2026-07-24 停服");
    expect(out).toContain("建议改用 deepseek-v4-flash");
    expect(deps.saved[0]).toMatchObject({ model: "deepseek-v4-flash" });
  });

  it("拒绝替换则保留原模型", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "1", "", "deepseek-chat", "n"],
        askSecret: ["sk"],
      }),
    });
    await runSetupWizard(deps);
    expect(deps.saved[0]).toMatchObject({ model: "deepseek-chat" });
  });

  it("混元 hy3-preview 死线 2026-08-31 → 替换 hy3", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "10", "", "hunyuan-turbos-latest", ""], // 10=腾讯混元；回车接受替换
        askSecret: ["sk"],
      }),
    });
    await runSetupWizard(deps);
    expect(deps.text()).toContain("2026-06-22 停服");
    expect(deps.saved[0]).toMatchObject({
      id: "hunyuan",
      model: "hy3",
      baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    });
  });
});

// ── 3. 实时模型列表（/models） ─────────────────────────────────

describe("setup wizard: 实时模型列表", () => {
  it("探测成功：实时优先合并展示（实时新增标记 + 目录价格补充）", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "1", "", "1"],
        askSecret: ["sk"],
      }),
      listModels: async () => ({
        ok: true,
        kind: "ok",
        ids: ["deepseek-v4-flash", "deepseek-v4-ultra"],
        detail: "实时模型列表：2 个模型",
      }),
    });
    await runSetupWizard(deps);
    const out = deps.text();
    expect(out).toContain("实时优先，目录价格/特性按 id 补充");
    expect(out).toContain("deepseek-v4-ultra");
    expect(out).toContain("（实时新增）");
    expect(out).toContain("（目录）"); // deepseek-v4-pro 只在目录
    expect(out).toContain("★默认");
    // 冒烟后带 key 复核：所选模型在实时列表中
    expect(out).toContain("已在供应商实时列表确认（共 2 个模型）");
  });

  it("复核时模型不在实时列表 → 警告但照常保存（冒烟已过）", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "1", "", ""],
        askSecret: ["sk"],
      }),
      listModels: async (input) =>
        input.apiKey
          ? { ok: true, kind: "ok", ids: ["some-other-model"], detail: "实时模型列表：1 个模型" }
          : AUTH_MODELS,
    });
    const result = await runSetupWizard(deps);
    expect(result.verified).toBe(true);
    expect(deps.text()).toContain("实时列表中未见「deepseek-v4-flash」");
  });
});

// ── 3b. 目录校准状态（三层新鲜度 L3） ─────────────────────────

describe("setup wizard: 目录校准状态展示", () => {
  const calibratedEntry = {
    providerId: "deepseek",
    billingId: "paygo",
    baseUrl: "https://api.deepseek.com",
    modelIds: ["deepseek-v4-flash", "deepseek-live-only"],
    checkedAt: Date.now() - 2 * 3_600_000,
  };

  it("未校准：选模型页提示 `penglai catalog refresh` 可校准", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({ ask: ["", "1", "", ""], askSecret: ["sk"] }),
      catalogOverlay: async () => [],
    });
    await runSetupWizard(deps);
    expect(deps.text()).toContain("未校准 · 配好 key 后 `penglai catalog refresh` 可实时校准");
  });

  it("已校准：显示「已知模型 N 个 · 校准于 <时间>」", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({ ask: ["", "1", "", ""], askSecret: ["sk"] }),
      catalogOverlay: async () => [calibratedEntry],
    });
    await runSetupWizard(deps);
    expect(deps.text()).toContain("已知模型 2 个 · 校准于 2 小时前");
  });

  it("实时探测失败时用校准缓存兜底（缓存新增的模型也可见）", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({ ask: ["", "1", "", ""], askSecret: ["sk"] }),
      listModels: async () => AUTH_MODELS, // 401 → 无实时
      catalogOverlay: async () => [calibratedEntry],
    });
    await runSetupWizard(deps);
    const out = deps.text();
    expect(out).toContain("实时列表不可用，改用上次校准缓存");
    expect(out).toContain("deepseek-live-only"); // 校准缓存里的实时新增可见
  });

  it("实时探测成功时实时优先（校准状态行照常显示）", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({ ask: ["", "1", "", ""], askSecret: ["sk"] }),
      listModels: async () => ({
        ok: true,
        kind: "ok",
        ids: ["deepseek-v4-flash"],
        detail: "实时模型列表：1 个模型",
      }),
      catalogOverlay: async () => [calibratedEntry],
    });
    await runSetupWizard(deps);
    const out = deps.text();
    expect(out).toContain("实时优先，目录价格/特性按 id 补充");
    expect(out).not.toContain("改用上次校准缓存");
  });
});

// ── 4. key 与冒烟失败菜单 ──────────────────────────────────────

describe("setup wizard: key 与冒烟", () => {
  it("env:VAR 存引用而非 key 本体", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "1", "", ""],
        askSecret: ["env:DEEPSEEK_API_KEY"],
      }),
    });
    await runSetupWizard(deps);
    expect(deps.saved[0]).toMatchObject({ apiKey: "", apiKeyEnv: "DEEPSEEK_API_KEY" });
    expect(deps.text()).toContain("key 走环境变量 DEEPSEEK_API_KEY");
  });

  it("冒烟失败 → 重输 key → 第二次通过", async () => {
    let smokes = 0;
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "1", "", "", "1"], // 失败菜单选 1=重输
        askSecret: ["sk-bad", "sk-good"],
      }),
      smoke: async () => {
        smokes += 1;
        return smokes === 1 ? AUTH_SMOKE : OK_SMOKE;
      },
    });
    const result = await runSetupWizard(deps);
    expect(result.verified).toBe(true);
    expect(smokes).toBe(2);
    expect(deps.saved[0]).toMatchObject({ apiKey: "sk-good" });
    expect(deps.text()).toContain("API key 无效或被拒绝");
  });

  it("冒烟失败 → 返回换模型 → 新模型通过", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "1", "", "", "2", "2"], // 失败菜单 2=返回换模型 → 选 2 号
        askSecret: ["sk-bad", "sk-good"],
      }),
      smoke: async (input) => (input.apiKey === "sk-bad" ? AUTH_SMOKE : OK_SMOKE),
    });
    const result = await runSetupWizard(deps);
    expect(result.verified).toBe(true);
    expect(deps.saved[0]).toMatchObject({ model: "deepseek-v4-pro", apiKey: "sk-good" });
  });

  it("冒烟失败 → 跳过验证先保存（带警告）", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "1", "", "", "3"],
        askSecret: ["sk-unverified"],
      }),
      smoke: async () => ({
        ok: false,
        kind: "network",
        detail: "网络不可达或端点地址错误（ECONNREFUSED）——检查 base URL 与网络连接",
        latencyMs: 5,
      }),
    });
    const result = await runSetupWizard(deps);
    expect(result).toEqual({ profileId: "deepseek", verified: false, skipped: true });
    expect(deps.saved).toHaveLength(1);
    expect(deps.text()).toContain("跳过验证");
  });

  it("非法序号与空 key 都会重问", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "99", "1", "", ""],
        askSecret: ["", "sk-ok"],
      }),
    });
    const result = await runSetupWizard(deps);
    expect(result.profileId).toBe("deepseek");
    const out = deps.text();
    expect(out).toContain("无效序号");
    expect(out).toContain("key 不能为空");
  });
});

// ── 5. 自定义端点简化路径 ──────────────────────────────────────

describe("setup wizard: 自定义端点", () => {
  it("base_url → id → key → /models 实时列表选模型 → 验活", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "11", "http://127.0.0.1:11434/v1", "", "2"],
        askSecret: ["sk-local"],
      }),
      listModels: async () => ({
        ok: true,
        kind: "ok",
        ids: ["m-a", "m-b"],
        detail: "实时模型列表：2 个模型",
      }),
    });
    const result = await runSetupWizard(deps);
    expect(result).toEqual({ profileId: "custom", verified: true, skipped: false });
    expect(deps.saved[0]).toMatchObject({
      id: "custom",
      provider: "custom",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "m-b",
      apiKey: "sk-local",
    });
  });

  it("/models 失败 → 手输模型名；0 可返回改 base_url", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "11", "http://127.0.0.1:11434/v1", "", "my-model"],
        askSecret: ["sk-local"],
      }),
    });
    const result = await runSetupWizard(deps);
    expect(result.verified).toBe(true);
    expect(deps.saved[0]).toMatchObject({ model: "my-model" });
    // /models 探测 401 → 降级说明 + 手输模型路径（手输的模型名进了保存行）
    expect(deps.text()).toContain("模型列表需要鉴权");
    expect(deps.text()).toContain("my-model @ http://127.0.0.1:11434/v1");
  });

  it("base_url 非法会重问；输 0 返回供应商页", async () => {
    const deps = wizardDeps({
      prompter: scriptedPrompter({
        ask: ["", "11", "0", "1", "", ""], // 自定义页输 0 → 回供应商页 → DeepSeek 全默认
        askSecret: ["sk"],
      }),
    });
    const result = await runSetupWizard(deps);
    expect(result.profileId).toBe("deepseek");
  });
});

// ── 6. 翻页渲染 ────────────────────────────────────────────────

describe("setup wizard: 翻页渲染（mock tty）", () => {
  const savedTerm = process.env.TERM;
  const savedNoColor = process.env.NO_COLOR;
  beforeEach(() => {
    process.env.TERM = "xterm-256color";
    delete process.env.NO_COLOR;
  });
  afterEach(() => {
    if (savedTerm === undefined) delete process.env.TERM;
    else process.env.TERM = savedTerm;
    if (savedNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = savedNoColor;
  });

  it("tty：每页清屏 + 迷你 banner + 步骤头；欢迎页全 banner 带印章", async () => {
    const cap = captureIo(true);
    const deps = wizardDeps({
      io: cap.io,
      pager: createPager(cap.io),
      prompter: scriptedPrompter({
        ask: ["", "1", "", ""],
        askSecret: ["sk"],
      }),
    });
    await runSetupWizard(deps);
    const out = cap.text();
    // 清屏序列：供应商页 / 计费摘要页 / 模型页 / key 页 ≥ 4 次
    expect(occurrences(out, "\u001b[2J\u001b[H")).toBeGreaterThanOrEqual(4);
    // 迷你 banner（翻页页顶身份感）
    expect(occurrences(out, "蓬 萊")).toBeGreaterThanOrEqual(4);
    expect(out).toContain("Penglai");
    // 全 banner：水墨 logo + 印章 + 身份行
    expect(out).toContain("██████╗ ███████╗");
    expect(out).toContain("蓬 莱 · 个人 AI 助理 0.4.0");
    expect(out).toContain("八仙过海，各显神通");
    // 步骤头
    expect(out).toContain("🏮");
    expect(out).toContain("步骤 1/4");
    expect(out).toContain("步骤 4/4");
    // 256 色水墨（雾青 152 起步）
    expect(out).toContain("[38;5;152m");
  });

  it("非 tty：无清屏序列、无颜色，顺序步骤头照常", async () => {
    const cap = captureIo(false);
    const deps = wizardDeps({
      io: cap.io,
      pager: createPager(cap.io),
      prompter: scriptedPrompter({
        ask: ["", "1", "", ""],
        askSecret: ["sk"],
      }),
    });
    await runSetupWizard(deps);
    const out = cap.text();
    expect(out).not.toContain("\u001b[2J");
    expect(out).not.toContain("[38;5;");
    expect(out).toContain("步骤 1/4");
    expect(out).toContain("步骤 4/4");
    expect(out).toContain("蓬 莱 · 个人 AI 助理 0.4.0");
  });

  it("NO_COLOR 下 tty 也降级为顺序文本", async () => {
    process.env.NO_COLOR = "1";
    const cap = captureIo(true);
    const deps = wizardDeps({
      io: cap.io,
      pager: createPager(cap.io),
      prompter: scriptedPrompter({
        ask: ["", "1", "", ""],
        askSecret: ["sk"],
      }),
    });
    await runSetupWizard(deps);
    expect(cap.text()).not.toContain("\u001b[2J");
    expect(cap.text()).not.toContain("[38;5;");
  });
});

// ── 7. 端到端（真实 host + mock 模型端点） ─────────────────────

describe("setup wizard: bare-run end-to-end", () => {
  const TOKEN = "wizard-e2e-token";
  // PENGLAI_DATA_DIR：向导后的身份诞生环节（种子 SOP/身份 L1）直写数据目录，
  // 必须隔离到测试临时目录，绝不碰真实 ~/.penglai。
  const ENV_KEYS = ["GROK_API_KEY", "DEEPSEEK_API_KEY", "ZAI_API_KEY", "OPENAI_API_KEY", "PENGLAI_DATA_DIR"] as const;
  let dataDir = "";
  let home = "";
  let mock: MockModelServer;
  let server: StartedServer | null = null;
  let argv: string[] = [];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-wizard-data-"));
    process.env.PENGLAI_DATA_DIR = dataDir;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-wizard-home-"));
    _setPenglaiHomeForTest(home);
    mock = new MockModelServer();
    await mock.start();
    server = await startServer({
      port: 0,
      token: TOKEN,
      dataDir,
      databasePath: path.join(dataDir, "product.db"),
      log: () => undefined,
    });
    argv = ["--port", String(server.port), "--token", TOKEN];
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    if (server) {
      server.server.closeIdleConnections();
      await server.close();
      server = null;
    }
    await mock.close();
    _setPenglaiHomeForTest(null);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("裸 `penglai` 无档案：自定义端点 → 真实 /models + 冒烟 → 保存 → 身份诞生 → chat", async () => {
    mock.registerModelIds(["mock-model", "mock-model-pro"]);
    const cap = captureIo(true);
    const prompter = scriptedPrompter({
      ask: ["", "11", mock.baseUrl, "", "1", "", ""], // 向导 → 仪式 Y + 默认名蓬莱
      askSecret: ["wizard-key"],
    });
    const code = await runCli(argv, {
      io: cap.io,
      wizardPrompter: prompter,
      stdin: Readable.from(["/exit\n"]),
    });
    expect(code).toBe(0);

    const out = cap.text();
    expect(out).toContain("蓬莱第一次醒来");
    expect(out).toContain("实时模型列表：2 个模型"); // /models 真实打通
    expect(out).toContain("冒烟验证：真实调用一次模型");
    expect(out).toContain("已连通（HTTP 200");
    expect(out).toContain("档案已保存：custom");
    // 身份诞生环节：自我介绍 + 种子 SOP 入树 + 身份落 L1。
    expect(out).toContain("身份诞生");
    expect(out).toContain("你好，我是蓬莱，今天诞生");
    expect(out).toContain("工作纪律「verify_sop」过审入树");
    const l1 = fs.readFileSync(path.join(dataDir, "memory", "global", "L1.md"), "utf-8");
    expect(l1).toContain("penglai:identity:start");
    expect(l1).toContain("sop/verify_sop");
    expect(out).toContain("penglai 0.4.0 · 浮动 ·");
    expect(out).toContain("/exit · /mode 切档 · /new");

    // 冒烟真实打到 mock 端点一次（max_tokens=1 ping）。
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].body.model).toBe("mock-model");

    // 档案落盘 0600 + 字面 key。
    const file = path.join(dataDir, "profiles.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const persisted = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      profiles: Array<{ id: string; apiKey?: string; baseUrl: string; model: string }>;
    };
    expect(persisted.profiles).toHaveLength(1);
    expect(persisted.profiles[0]).toMatchObject({
      id: "custom",
      baseUrl: mock.baseUrl,
      model: "mock-model",
      apiKey: "wizard-key",
    });
  });

  it("/models 未注册的端点：降级手输模型，流程不断（仪式可跳过）", async () => {
    const cap = captureIo(true);
    const prompter = scriptedPrompter({
      ask: ["", "11", mock.baseUrl, "", "typed-model", "n"], // 向导 → 仪式跳过
      askSecret: ["wizard-key"],
    });
    const code = await runCli(["setup", ...argv], {
      io: cap.io,
      wizardPrompter: prompter,
      stdin: Readable.from([]),
    });
    expect(code).toBe(0);
    expect(cap.text()).toContain("档案已保存：custom");
    expect(cap.text()).toContain("改天再办"); // 仪式跳过路径
    const persisted = JSON.parse(
      fs.readFileSync(path.join(dataDir, "profiles.json"), "utf-8"),
    ) as { profiles: Array<{ model: string }> };
    expect(persisted.profiles[0].model).toBe("typed-model");
  });

  it("有 key 就绪档案的裸跑直接进 chat（0.3.x 传统）", async () => {
    mock.registerModelIds(["mock-model"]);
    const seed = captureIo(true);
    const prompter = scriptedPrompter({
      ask: ["", "11", mock.baseUrl, "", "1", "n"], // 向导 → 仪式跳过
      askSecret: ["seeded-key"],
    });
    expect(
      await runCli(["setup", ...argv], { io: seed.io, wizardPrompter: prompter, stdin: Readable.from([]) }),
    ).toBe(0);
    expect(seed.text()).toContain("档案已保存");

    const cap = captureIo(true);
    const code = await runCli(argv, {
      io: cap.io,
      wizardPrompter: scriptedPrompter({}), // 若被提问会抛错
      stdin: Readable.from(["/exit\n"]),
    });
    expect(code).toBe(0);
    expect(cap.text()).not.toContain("蓬莱第一次醒来");
    expect(cap.text()).toContain("penglai 0.4.0 · 浮动 ·");
  });

  it("非 tty 裸跑降级为一行引导，不挂起", async () => {
    const cap = captureIo(false);
    const code = await runCli(argv, { io: cap.io });
    expect(code).toBe(0);
    expect(cap.text()).toContain(SETUP_NONTTY_GUIDANCE);
    expect(cap.text()).not.toContain("蓬莱第一次醒来");
  });

  it("非 tty `penglai setup` 打印同样的一行引导", async () => {
    const cap = captureIo(false);
    const code = await runCli(["setup", ...argv], { io: cap.io });
    expect(code).toBe(0);
    expect(cap.text()).toContain(SETUP_NONTTY_GUIDANCE);
  });
});
