/**
 * 实时模型列表（GET /models）与目录合并测试。
 *
 *   1. listRemoteModels：成功解析 / 401→auth / 404→endpoint / 连接拒绝→
 *      network / 超时→timeout / 非法 JSON 与空列表→endpoint 降级。
 *   2. mergeModels：实时列表优先，目录价格/特性按 id 匹配补充，目录独有
 *      模型排在后面，实时新增模型以 id 直出。
 */

import * as http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listRemoteModels,
  mergeModels,
} from "../src/providers/models.js";
import type { CatalogModel } from "../src/providers/catalog.js";

// ── 微型 /models 端点 ──────────────────────────────────────────

interface FakeModels {
  server: http.Server;
  baseUrl: string;
  close: () => Promise<void>;
}

async function fakeModelsEndpoint(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<FakeModels> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

describe("listRemoteModels: 成功与降级分类", () => {
  let fake: FakeModels | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  it("成功：解析 data[].id，透传 bearer key", async () => {
    let seenAuth = "";
    fake = await fakeModelsEndpoint((req, res) => {
      seenAuth = req.headers.authorization ?? "";
      json(res, 200, {
        object: "list",
        data: [{ id: "m-1", object: "model" }, { id: "m-2" }, { nope: true }],
      });
    });
    const result = await listRemoteModels({ baseUrl: fake.baseUrl, apiKey: "sk-test" });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("ok");
    expect(result.ids).toEqual(["m-1", "m-2"]);
    expect(result.detail).toContain("2 个模型");
    expect(seenAuth).toBe("Bearer sk-test");
  });

  it("401 → auth 降级", async () => {
    fake = await fakeModelsEndpoint((_req, res) => json(res, 401, { error: { message: "bad key" } }));
    const result = await listRemoteModels({ baseUrl: fake.baseUrl, apiKey: "wrong" });
    expect(result).toMatchObject({ ok: false, kind: "auth", ids: [] });
  });

  it("404 → endpoint 降级", async () => {
    fake = await fakeModelsEndpoint((_req, res) => json(res, 404, { error: { message: "no route" } }));
    const result = await listRemoteModels({ baseUrl: fake.baseUrl });
    expect(result).toMatchObject({ ok: false, kind: "endpoint" });
    expect(result.detail).toContain("404");
  });

  it("非法 JSON → endpoint 降级；空列表 → endpoint 降级", async () => {
    fake = await fakeModelsEndpoint((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("not json{");
    });
    expect((await listRemoteModels({ baseUrl: fake.baseUrl })).kind).toBe("endpoint");
    await fake.close();
    fake = await fakeModelsEndpoint((_req, res) => json(res, 200, { data: [] }));
    expect((await listRemoteModels({ baseUrl: fake.baseUrl })).kind).toBe("endpoint");
  });

  it("连接拒绝 → network 降级", async () => {
    // 找一个未监听端口：先开后关。
    fake = await fakeModelsEndpoint((_req, res) => json(res, 200, { data: [{ id: "x" }] }));
    const dead = fake.baseUrl;
    await fake.close();
    fake = null;
    const result = await listRemoteModels({ baseUrl: dead, timeoutMs: 2_000 });
    expect(result).toMatchObject({ ok: false, kind: "network" });
  });

  it("超时 → timeout 降级", async () => {
    fake = await fakeModelsEndpoint((_req, res) => {
      setTimeout(() => json(res, 200, { data: [{ id: "x" }] }), 500);
    });
    const result = await listRemoteModels({ baseUrl: fake.baseUrl, timeoutMs: 50 });
    expect(result).toMatchObject({ ok: false, kind: "timeout" });
  });
});

// ── 合并逻辑 ───────────────────────────────────────────────────

const CATALOG_MODELS: CatalogModel[] = [
  { id: "alpha", display: "Alpha（推荐）", context_k: 256, input_cny: 1, output_cny: 2, features: ["tools"], default: true },
  { id: "beta", display: "Beta", context_k: 128, input_cny: 0.5, output_cny: 1 },
  { id: "gamma", display: "Gamma", context_k: 64 },
];

describe("mergeModels: 实时优先 + 目录补充", () => {
  it("实时列表顺序优先，目录信息按 id 补充，目录独有排后", () => {
    const merged = mergeModels(CATALOG_MODELS, ["beta", "alpha", "delta-live"]);
    expect(merged.map((m) => m.id)).toEqual(["beta", "alpha", "delta-live", "gamma"]);
    // both：目录信息补齐
    expect(merged[0]).toMatchObject({ source: "both", display: "Beta", isDefault: false });
    expect(merged[0].catalog?.input_cny).toBe(0.5);
    expect(merged[1]).toMatchObject({ source: "both", isDefault: true });
    // live-only：以 id 直出，无目录条目
    expect(merged[2]).toMatchObject({ source: "live", display: "delta-live", isDefault: false });
    expect(merged[2].catalog).toBeUndefined();
    // catalog-only
    expect(merged[3]).toMatchObject({ source: "catalog", display: "Gamma" });
  });

  it("实时列表为空 = 纯目录（探测失败的降级形态）", () => {
    const merged = mergeModels(CATALOG_MODELS, []);
    expect(merged.map((m) => m.id)).toEqual(["alpha", "beta", "gamma"]);
    expect(merged.every((m) => m.source === "catalog")).toBe(true);
  });

  it("实时列表去重；目录为空时全部 live", () => {
    const merged = mergeModels([], ["x", "x", "y"]);
    expect(merged.map((m) => m.id)).toEqual(["x", "y"]);
    expect(merged.every((m) => m.source === "live")).toBe(true);
  });
});
