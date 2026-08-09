/**
 * 目录自校准测试（三层新鲜度：yaml 种子 → 实时拉取 → refresh 覆盖层）。
 *
 *   1. 覆盖层存储：save/load 回环、损坏容错、同键替换、原子写权限。
 *   2. 合并与文案：withOverlayModels 追加实时新增 id、calibrationLine。
 *   3. 刷新逻辑（refreshCatalog）：档案→计费模式匹配（provider+baseUrl /
 *      跨供应商 baseUrl / 默认模式注记 / not-in-catalog）、无 key 如实报告
 *      「配置后可校准」、失败分类传播、成功落覆盖层——listRemoteModels
 *      全部走注入缝，零真实网络。
 *   4. 端到端：真实 host + mock 模型端点（/models 真实 HTTP 往返）→
 *      catalog.refresh RPC 落覆盖层 → catalog.status / `penglai catalog` 可见。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelProfile } from "@penglai/protocol";
import { startServer, type StartedServer } from "../src/server.js";
import { _setPenglaiHomeForTest } from "../src/conversation-store.js";
import { MockModelServer } from "./fixtures/mock-model-server.js";
import { runCli } from "../src/cli/main.js";
import { CATALOG, modelsOf } from "../src/providers/catalog.js";
import {
  calibrationLine,
  catalogOverlayPath,
  loadCatalogOverlay,
  overlayEntryFor,
  saveCatalogOverlayEntry,
  withOverlayModels,
  type CatalogOverlayEntry,
} from "../src/providers/overlay.js";
import {
  matchCatalogBilling,
  refreshCatalog,
  type RefreshDeps,
} from "../src/providers/refresh.js";
import type { ListModelsResult } from "../src/providers/models.js";
import type { CliIO } from "../src/cli/format.js";

// ── 1. 覆盖层存储 ──────────────────────────────────────────────

describe("catalog overlay: 持久化", () => {
  let dataDir = "";
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-overlay-"));
  });
  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const entry: CatalogOverlayEntry = {
    providerId: "deepseek",
    billingId: "paygo",
    baseUrl: "https://api.deepseek.com",
    modelIds: ["deepseek-v4-flash", "deepseek-v4-pro"],
    checkedAt: 1_790_000_000_000,
  };

  it("save/load 回环 + 同键替换 + 0600", () => {
    expect(loadCatalogOverlay(dataDir)).toEqual([]);
    saveCatalogOverlayEntry(dataDir, entry);
    expect(loadCatalogOverlay(dataDir)).toEqual([entry]);
    // 同 provider/billing 覆盖而非追加
    const next = { ...entry, modelIds: ["deepseek-v5"], checkedAt: entry.checkedAt + 1000 };
    saveCatalogOverlayEntry(dataDir, next);
    const loaded = loadCatalogOverlay(dataDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].modelIds).toEqual(["deepseek-v5"]);
    expect(fs.statSync(catalogOverlayPath(dataDir)).mode & 0o777).toBe(0o600);
  });

  it("损坏/非法内容容错为空", () => {
    fs.writeFileSync(catalogOverlayPath(dataDir), "{not json");
    expect(loadCatalogOverlay(dataDir)).toEqual([]);
    fs.writeFileSync(
      catalogOverlayPath(dataDir),
      JSON.stringify({ schemaVersion: 1, entries: [{ providerId: 1 }, { nope: true }] }),
    );
    expect(loadCatalogOverlay(dataDir)).toEqual([]);
  });

  it("overlayEntryFor 按 provider+billing 精确命中", () => {
    saveCatalogOverlayEntry(dataDir, entry);
    saveCatalogOverlayEntry(dataDir, {
      ...entry,
      providerId: "volcengine",
      billingId: "coding_plan",
    });
    const overlay = loadCatalogOverlay(dataDir);
    expect(overlayEntryFor(overlay, "deepseek", "paygo")?.modelIds).toHaveLength(2);
    expect(overlayEntryFor(overlay, "deepseek", "coding_plan")).toBeUndefined();
    expect(overlayEntryFor(overlay, "zhipu", "paygo")).toBeUndefined();
  });
});

// ── 2. 合并与文案 ──────────────────────────────────────────────

describe("catalog overlay: 合并与文案", () => {
  it("withOverlayModels 追加实时新增 id，种子模型与价格保留", () => {
    const overlay: CatalogOverlayEntry[] = [
      {
        providerId: "deepseek",
        billingId: "paygo",
        baseUrl: "https://api.deepseek.com",
        modelIds: ["deepseek-v4-flash", "deepseek-future-x"], // 一个已知 + 一个新增
        checkedAt: Date.now(),
      },
    ];
    const merged = withOverlayModels(CATALOG, overlay);
    const models = modelsOf("deepseek", "paygo", merged);
    const seedModels = modelsOf("deepseek", "paygo", CATALOG);
    // 种子模型一个不少、顺序不变
    expect(models.slice(0, seedModels.length).map((m) => m.id)).toEqual(
      seedModels.map((m) => m.id),
    );
    // 实时新增排尾，display 用 id 本体，不发明价格
    const extra = models[models.length - 1];
    expect(extra.id).toBe("deepseek-future-x");
    expect(extra.display).toBe("deepseek-future-x");
    expect(extra.input_cny).toBeUndefined();
    // 已知 id 不重复追加
    expect(models.filter((m) => m.id === "deepseek-v4-flash")).toHaveLength(1);
    // 空覆盖层原样返回（同一引用）
    expect(withOverlayModels(CATALOG, [])).toBe(CATALOG);
  });

  it("calibrationLine：未校准 null；分钟/小时/天分档", () => {
    expect(calibrationLine(undefined)).toBeNull();
    const now = 1_790_000_000_000;
    const base = {
      providerId: "deepseek",
      billingId: "paygo",
      baseUrl: "https://api.deepseek.com",
      modelIds: ["a", "b", "c"],
    };
    expect(calibrationLine({ ...base, checkedAt: now - 5 * 60_000 }, now)).toBe(
      "已知模型 3 个 · 校准于 5 分钟前",
    );
    expect(calibrationLine({ ...base, checkedAt: now - 3 * 3_600_000 }, now)).toBe(
      "已知模型 3 个 · 校准于 3 小时前",
    );
    expect(calibrationLine({ ...base, checkedAt: now - 9 * 86_400_000 }, now)).toBe(
      "已知模型 3 个 · 校准于 9 天前",
    );
  });
});

// ── 3. 刷新逻辑（注入缝，零网络） ──────────────────────────────

function profile(partial: Partial<ModelProfile> & { id: string }): ModelProfile {
  return {
    label: partial.id,
    provider: "custom",
    baseUrl: "https://example.invalid/v1",
    model: "m",
    apiKeyEnv: "",
    capabilities: { tools: true, streaming: true, vision: false },
    ...partial,
  };
}

describe("catalog refresh: 档案 → 计费模式匹配", () => {
  it("provider 命中 + baseUrl 精确匹配计费模式", () => {
    const p = profile({
      id: "deepseek",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/",
    });
    const match = matchCatalogBilling(p, CATALOG);
    expect(match?.providerId).toBe("deepseek");
    expect(match?.billingId).toBe("paygo");
    expect(match?.note).toBe("");
  });

  it("provider 命中但端点不匹配 → 默认计费模式 + 注记", () => {
    const p = profile({
      id: "ds-relay",
      provider: "deepseek",
      baseUrl: "https://relay.example.com/v1",
    });
    const match = matchCatalogBilling(p, CATALOG);
    expect(match?.providerId).toBe("deepseek");
    expect(match?.billingId).toBe(CATALOG.providers.deepseek.default_billing);
    expect(match?.note).toContain("默认计费模式");
  });

  it("provider 不在目录（内建 glm）→ 跨供应商按 baseUrl 匹配", () => {
    const zhipuPaygo = CATALOG.providers.zhipu.billing[CATALOG.providers.zhipu.default_billing];
    const p = profile({ id: "glm", provider: "glm", baseUrl: zhipuPaygo.base_url });
    const match = matchCatalogBilling(p, CATALOG);
    expect(match?.providerId).toBe("zhipu");
    expect(match?.note).toContain("按端点匹配");
  });

  it("完全自定义端点 → null（not-in-catalog）", () => {
    const p = profile({ id: "local", provider: "custom", baseUrl: "http://127.0.0.1:8000/v1" });
    expect(matchCatalogBilling(p, CATALOG)).toBeNull();
  });
});

describe("catalog refresh: refreshCatalog 全分类", () => {
  const profiles = [
    profile({
      id: "deepseek",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DS_KEY",
    }),
    profile({
      id: "zhipu",
      provider: "zhipu",
      baseUrl: CATALOG.providers.zhipu.billing[CATALOG.providers.zhipu.default_billing].base_url,
      apiKeyEnv: "ZP_KEY",
    }),
    profile({ id: "nokey", provider: "deepseek", baseUrl: "https://api.deepseek.com" }),
    profile({ id: "local", provider: "custom", baseUrl: "http://127.0.0.1:8000/v1", apiKeyEnv: "L_KEY" }),
  ];
  const keys: Record<string, string> = { DS_KEY: "sk-ds", ZP_KEY: "sk-zp", L_KEY: "sk-l" };

  function depsFor(listResult: (baseUrl: string) => ListModelsResult): RefreshDeps & {
    saved: CatalogOverlayEntry[];
  } {
    const saved: CatalogOverlayEntry[] = [];
    return {
      saved,
      listProfiles: () => profiles,
      resolveApiKey: (p) => (p.apiKeyEnv ? (keys[p.apiKeyEnv] ?? "") : ""),
      saveEntry: (e) => saved.push(e),
      listRemoteModels: async ({ baseUrl }) => listResult(baseUrl),
      now: () => 1_790_000_000_000,
    };
  }

  it("成功校准落覆盖层；无 key / 不在目录如实跳过", async () => {
    const deps = depsFor((baseUrl) =>
      baseUrl.includes("deepseek")
        ? { ok: true, kind: "ok", ids: ["deepseek-v4-flash", "deepseek-v5"], detail: "" }
        : { ok: false, kind: "auth", ids: [], detail: "401" },
    );
    const report = await refreshCatalog(deps);
    const byId = Object.fromEntries(report.rows.map((r) => [r.profileId, r]));
    expect(byId.deepseek.status).toBe("refreshed");
    expect(byId.deepseek.count).toBe(2);
    expect(byId.deepseek.checkedAt).toBe(1_790_000_000_000);
    expect(byId.zhipu.status).toBe("auth"); // 失败分类传播，不落盘
    expect(byId.nokey.status).toBe("no-key");
    expect(byId.nokey.detail).toContain("配置后可校准");
    expect(byId.local.status).toBe("not-in-catalog");
    expect(deps.saved).toHaveLength(1);
    expect(deps.saved[0]).toMatchObject({
      providerId: "deepseek",
      billingId: "paygo",
      modelIds: ["deepseek-v4-flash", "deepseek-v5"],
    });
    expect(report).toMatchObject({ refreshed: 1, failed: 1, skipped: 2 });
  });

  it("单档案异常不扩散：listRemoteModels 永不抛的契约由调用方守护", async () => {
    const deps = depsFor(() => ({ ok: false, kind: "timeout", ids: [], detail: "超时" }));
    const report = await refreshCatalog(deps);
    expect(report.refreshed).toBe(0);
    expect(report.failed).toBe(2); // deepseek + zhipu 两个有 key 的
    expect(report.rows.every((r) => typeof r.detail === "string")).toBe(true);
  });
});

// ── 4. 端到端（真实 host + mock 端点 /models 真实往返） ────────

describe("catalog refresh: end-to-end", () => {
  const TOKEN = "catalog-e2e-token";
  const ENV_KEYS = ["GROK_API_KEY", "DEEPSEEK_API_KEY", "ZAI_API_KEY", "OPENAI_API_KEY"] as const;
  let dataDir = "";
  let home = "";
  let mock: MockModelServer;
  let server: StartedServer | null = null;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-catalog-data-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-catalog-home-"));
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

  async function rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const res = await fetch(`http://127.0.0.1:${server!.port}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Penglai-Token": TOKEN },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = await res.json();
    if (body.error) throw new Error(body.error.message);
    return body.result;
  }

  it("refresh：有 key 档案实拉 /models 落覆盖层；内建档案无 key 如实跳过", async () => {
    mock.registerModelIds(["zhipu-live-a", "zhipu-live-b", "glm-flash"]);
    // 档案指向 mock 端点，provider=glm（不在目录 id）→ 跨供应商按 baseUrl
    // 匹配；mock 端点不在目录 → not-in-catalog。换成 provider=zhipu + 注记路径：
    await rpc("config.createProfile", {
      id: "zhipu",
      provider: "zhipu",
      baseUrl: mock.baseUrl,
      model: "glm-flash",
      apiKey: "catalog-key",
    });
    const report = await rpc("catalog.refresh", {});
    const mine = report.rows.find((r: { profileId: string }) => r.profileId === "zhipu");
    expect(mine.status).toBe("refreshed");
    expect(mine.count).toBe(3);
    expect(mine.providerId).toBe("zhipu");
    expect(mine.detail).toContain("默认计费模式"); // 端点 ≠ 目录，按默认模式校准
    // 内建档案无 key → 如实跳过（绝不打真实网络）
    const builtin = report.rows.find((r: { profileId: string }) => r.profileId === "deepseek");
    expect(builtin.status).toBe("no-key");
    expect(builtin.detail).toContain("配置后可校准");
    // mock 只被有 key 的档案打了一次 /models
    expect(mock.modelsRequests).toHaveLength(1);

    // 覆盖层落盘 → catalog.status 可见
    const status = await rpc("catalog.status", {});
    expect(status.catalogUpdated).toBe("2026-07-29");
    const hit = status.overlay.find(
      (e: CatalogOverlayEntry) => e.providerId === "zhipu",
    );
    expect(hit.modelIds).toEqual(["zhipu-live-a", "zhipu-live-b", "glm-flash"]);
    expect(hit.checkedAt).toBeGreaterThan(0);

    // CLI 面板：status 显示校准状态；refresh 输出逐档案分类行
    const cap = { out: "", err: "" };
    const io: CliIO = {
      out: (t) => (cap.out += t),
      line: (t) => (cap.out += `${t}\n`),
      err: (t) => (cap.err += `${t}\n`),
      tty: false,
    };
    const argv = ["--port", String(server!.port), "--token", TOKEN];
    expect(await runCli(["catalog", ...argv], { io })).toBe(0);
    expect(cap.out).toContain("种子数据 2026-07-29");
    expect(cap.out).toContain("zhipu/paygo");
    expect(cap.out).toContain("已知模型 3 个 · 校准于");
    cap.out = "";
    expect(await runCli(["catalog", "refresh", ...argv], { io })).toBe(0);
    expect(cap.out).toContain("已校准 3 个模型");
    expect(cap.out).toContain("校准 1");
  });

  it("无 key 档案独占时 refresh 退出码 0 且明示可校准", async () => {
    const report = await rpc("catalog.refresh", {});
    expect(report.refreshed).toBe(0);
    expect(report.rows.every((r: { status: string }) => r.status === "no-key" || r.status === "not-in-catalog")).toBe(true);
    const status = await rpc("catalog.status", {});
    expect(status.overlay).toEqual([]);
  });
});
