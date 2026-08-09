/**
 * 身份诞生 host 侧核心 + onboarding.* RPC 测试（桌面首次启动向导的仪式面）。
 *
 * 钉死：runBirth 幂等（已有身份短路，不重复播种）；种子 SOP 过审入树；
 * L1 已满时如实 identityWritten=false（种子照常）；RPC 面
 * onboarding.status / onboarding.birthIdentity 的端到端形状。
 * 仪式四步的 CLI IO 侧已由 identity-ceremony.test.ts 覆盖，这里不重复。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/memory.js";
import { runBirth } from "../src/onboarding/birth.js";
import { introLines, sanitizeAssistantName } from "../src/onboarding/intro.js";
import { SEED_SOPS } from "../src/onboarding/seed-sops.js";
import { MEMORY_L1_MAX_LINES } from "../src/policy.js";
import { startServer, type StartedServer } from "../src/server.js";

const TODAY = "2026-07-30";

function makeMemory(): { memory: MemoryStore; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-birth-"));
  const memory = new MemoryStore(path.join(root, "memory", "global"));
  memory.ensureGlobalLayout();
  return { memory, root };
}

describe("runBirth（host 侧核心，无 IO）", () => {
  it("完整诞生：名字卫生 → 种子过审入树 → 身份落 L1", async () => {
    const { memory } = makeMemory();
    const result = await runBirth(memory, "  小贾\n维斯  ", () => TODAY);
    expect(result.ran).toBe(true);
    expect(result.name).toBe("小贾维斯");
    expect(result.bornAt).toBe(TODAY);
    expect(result.identityWritten).toBe(true);
    expect(result.seeds).toHaveLength(SEED_SOPS.length);
    expect(result.seeds!.every((s) => s.outcome === "planted")).toBe(true);
    expect(memory.readIdentity()).toEqual({ name: "小贾维斯", bornAt: TODAY });
  });

  it("幂等：已有身份直接短路，不重复仪式、不重复播种", async () => {
    const { memory } = makeMemory();
    const first = await runBirth(memory, "蓬莱", () => TODAY);
    expect(first.ran).toBe(true);
    const second = await runBirth(memory, "换个名字", () => TODAY);
    expect(second.ran).toBe(false);
    expect(second.existingName).toBe("蓬莱");
    expect(memory.readIdentity()?.name).toBe("蓬莱");
  });

  it("空名兜底默认名；种子同名在树时 kept 不覆盖", async () => {
    const { memory } = makeMemory();
    memory.writeGlobalSop(SEED_SOPS[0].name, "owner 既有版本", {
      sourceKind: "migrate",
      sourceTaskId: null,
      sourceRunId: null,
      sourceRef: "migration:test-existing-seed",
      evidenceId: null,
      auditedBy: "rules+migrate-03",
    });
    const result = await runBirth(memory, "   ", () => TODAY);
    expect(result.name).toBe("蓬莱");
    expect(result.seeds!.find((s) => s.name === SEED_SOPS[0].name)?.outcome).toBe("kept");
    expect(memory.readSop(SEED_SOPS[0].name)).toContain("owner 既有版本");
  });

  it("L1 已满：identityWritten=false 如实报告，种子照常入树", async () => {
    const { memory, root } = makeMemory();
    // 填满 L1 到铁律上限：filler 托管区（f 行 + 2 marker + 1 空行）恰好顶到
    // 30 行，随后的身份区（5 行 + 1 空行）必破顶 → writeIdentity 返回 false。
    const l1File = path.join(root, "memory", "global", "L1.md");
    const t0 = fs.readFileSync(l1File, "utf-8").replace(/\s+$/, "").split("\n").length;
    const f = MEMORY_L1_MAX_LINES - t0 - 4;
    expect(f).toBeGreaterThanOrEqual(1);
    expect(memory.writeManagedSection("filler", Array.from({ length: f }, (_, i) => `- 占位行 ${i + 1}`))).toBe(true);
    const result = await runBirth(memory, "蓬莱", () => TODAY);
    expect(result.ran).toBe(true);
    expect(result.identityWritten).toBe(false);
    expect(memory.readIdentity()).toBeNull();
    expect(result.seeds!.every((s) => s.outcome === "planted")).toBe(true);
  });

  it("文案模块：sanitize 去控制字符 ≤24 字；自我介绍 ≤5 行带名字", () => {
    expect(sanitizeAssistantName("")).toBe("蓬莱");
    expect(sanitizeAssistantName("a".repeat(40))).toHaveLength(24);
    const lines = introLines("阿蓬");
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines[0]).toContain("阿蓬");
  });
});

// ── RPC 面（真实 server，桌面向导走这条路） ────────────────────

const TEST_TOKEN = "onboarding-test-token";

describe("onboarding.* RPC", () => {
  let started: StartedServer;
  let dataDir: string;
  let baseUrl: string;

  const rpc = async <T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const res = await fetch(`${baseUrl}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Penglai-Token": TEST_TOKEN },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result as T;
  };

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-onboarding-rpc-"));
    started = await startServer({ port: 0, token: TEST_TOKEN, dataDir, log: () => undefined });
    baseUrl = `http://127.0.0.1:${started.port}`;
  });

  afterAll(async () => {
    await started.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("status：未诞生时 identity 为 null", async () => {
    const status = await rpc("onboarding.status");
    expect(status).toEqual({ identity: null });
  });

  it("birthIdentity：举行仪式，种子入树，身份可读回", async () => {
    const birth = await rpc("onboarding.birthIdentity", { name: "阿蓬" });
    expect(birth.ran).toBe(true);
    expect(birth.name).toBe("阿蓬");
    expect(birth.bornAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(birth.identityWritten).toBe(true);
    expect(birth.seeds.every((s: { outcome: string }) => s.outcome === "planted")).toBe(true);
    const status = await rpc("onboarding.status");
    expect(status.identity).toEqual({ name: "阿蓬", bornAt: birth.bornAt });
  });

  it("birthIdentity 二次调用幂等：ran=false + existingName", async () => {
    const again = await rpc("onboarding.birthIdentity", { name: "改名" });
    expect(again.ran).toBe(false);
    expect(again.existingName).toBe("阿蓬");
    const status = await rpc("onboarding.status");
    expect(status.identity.name).toBe("阿蓬");
  });

  it("name 缺省 = 默认名（新 host 上验证）", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-onboarding-default-"));
    const server2 = await startServer({ port: 0, token: TEST_TOKEN, dataDir: dir, log: () => undefined });
    try {
      const res = await fetch(`http://127.0.0.1:${server2.port}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Penglai-Token": TEST_TOKEN },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "onboarding.birthIdentity", params: {} }),
      });
      const body = await res.json();
      expect(body.result.ran).toBe(true);
      expect(body.result.name).toBe("蓬莱");
    } finally {
      await server2.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
