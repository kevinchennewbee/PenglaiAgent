/**
 * 冷启动身份引导测试（M3′：贾维斯第一天）。
 *
 * 钉死：种子 SOP 逐条过蒸馏环审计规则器（这是它们能入树的前提）；
 * 仪式四步（起名 → 自我介绍 ≤5 行 → 种子入树 → 身份落 L1）；
 * 可跳过 / 非 tty 降级 / 二次运行不重复；身份进系统提示词首行。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  introLines,
  plantSeedSops,
  runIdentityCeremony,
  sanitizeAssistantName,
} from "../src/cli/identity-ceremony.js";
import { SEED_SOPS } from "../src/onboarding/seed-sops.js";
import { auditCandidateSop } from "../src/distill/audit.js";
import { MemoryStore, L1_FILE_NAME } from "../src/memory.js";
import { buildSystemPrompt } from "../src/kernel/create-production-pi-kernel.js";
import { MEMORY_L1_MAX_LINES } from "../src/policy.js";
import type { CliIO } from "../src/cli/format.js";
import type { WizardPrompter } from "../src/cli/setup-wizard.js";

const TODAY = "2026-07-29";

let globalRoot = "";
let memory: MemoryStore;

function captureIo(tty = true): { io: CliIO; text: () => string } {
  let text = "";
  return {
    io: {
      out: (t) => { text += t; },
      line: (t) => { text += `${t}\n`; },
      err: (t) => { text += `${t}\n`; },
      tty,
    },
    text: () => text,
  };
}

function scripted(answers: string[]): WizardPrompter {
  const queue = [...answers];
  return {
    ask: (q) => {
      const answer = queue.shift();
      if (answer === undefined) return Promise.reject(new Error(`unscripted ask: ${q}`));
      return Promise.resolve(answer);
    },
    askSecret: () => Promise.reject(new Error("no secrets in ceremony")),
  };
}

beforeEach(() => {
  globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-ceremony-"));
  memory = new MemoryStore(globalRoot);
  memory.ensureGlobalLayout();
});

afterEach(() => {
  fs.rmSync(globalRoot, { recursive: true, force: true });
});

// ── 种子 SOP 包 ────────────────────────────────────────────────

describe("种子 SOP 包（0.3 纪律类精选，审计规则器是入树前提）", () => {
  it("每条种子都必须过审计规则表（钉死：不过审的包不存在）", async () => {
    for (const seed of SEED_SOPS) {
      const verdict = await auditCandidateSop(seed.content);
      expect(verdict.pass, `${seed.name} 未过审：${verdict.findings.map((f) => `${f.ruleId}:${f.excerpt}`).join("；")}`).toBe(true);
    }
  });

  it("种子是吸收判断点名的两条纪律：verify_sop + penglai_compress_sop", () => {
    expect(SEED_SOPS.map((s) => s.name)).toEqual(["verify_sop", "penglai_compress_sop"]);
    // 适配留痕：verify 的 curl 命令面已按 R2 改写；compress 的 0.3 L1-L4 已按 0.4 分区改写。
    expect(SEED_SOPS[0].content).not.toContain("curl");
    expect(SEED_SOPS[0].content).toContain("HTTP 抓取子资源");
    expect(SEED_SOPS[1].content).not.toContain("L4_raw_sessions");
    expect(SEED_SOPS[1].content).toContain("SOP 技能树");
  });

  it("plantSeedSops：过审入树 + L1 索引出现指针；二次调用 kept 不重复", async () => {
    const first = await plantSeedSops(memory);
    expect(first.map((o) => o.outcome)).toEqual(["planted", "planted"]);
    expect(memory.listSops().map((s) => s.name).sort()).toEqual(["penglai_compress_sop", "verify_sop"]);
    const l1 = fs.readFileSync(path.join(globalRoot, L1_FILE_NAME), "utf-8");
    expect(l1).toContain("sop/verify_sop");
    expect(l1.split("\n").length).toBeLessThanOrEqual(MEMORY_L1_MAX_LINES);

    const second = await plantSeedSops(memory);
    expect(second.map((o) => o.outcome)).toEqual(["kept", "kept"]);
    expect(memory.listSops()).toHaveLength(2);
  });

  it("迁移工具已入同名 SOP 时：kept 保留既有版本，不覆盖", async () => {
    memory.writeGlobalSop("verify_sop", "# 迁移版验证纪律\n\n迁移先入的内容。\n", {
      sourceKind: "migrate",
      sourceTaskId: null,
      sourceRunId: null,
      sourceRef: "migration:test-03",
      evidenceId: null,
      auditedBy: "rules+migrate-03",
    });
    const outcomes = await plantSeedSops(memory);
    expect(outcomes.find((o) => o.name === "verify_sop")?.outcome).toBe("kept");
    expect(memory.readSop("verify_sop")).toContain("迁移先入的内容");
  });
});

// ── 名字与自我介绍 ─────────────────────────────────────────────

describe("起名与自我介绍", () => {
  it("sanitizeAssistantName：空白兜底蓬莱、去控制字符、≤24 字", () => {
    expect(sanitizeAssistantName("")).toBe("蓬莱");
    expect(sanitizeAssistantName("   ")).toBe("蓬莱");
    expect(sanitizeAssistantName("小蓬\n坏")).toBe("小蓬坏");
    expect(sanitizeAssistantName("贾维斯")).toBe("贾维斯");
    expect(sanitizeAssistantName("x".repeat(40))).toHaveLength(24);
  });

  it("自我介绍 ≤5 行，覆盖单一核心/本地语音陪伴/记忆/进化", () => {
    const lines = introLines("贾维斯");
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines[0]).toContain("贾维斯");
    expect(lines.join("\n")).toContain("一套核心");
    expect(lines.join("\n")).toContain("SenseVoice");
    expect(lines.join("\n")).toContain("MOSS-TTS");
    expect(lines.join("\n")).toContain("主动陪伴");
    expect(lines.join("\n")).toContain("记忆");
    expect(lines.join("\n")).toContain("进化");
  });
});

// ── 仪式全流程 ─────────────────────────────────────────────────

describe("身份诞生仪式", () => {
  it("完整流程：自定义名字 → 自我介绍 → 种子入树 → 身份落 L1", async () => {
    const cap = captureIo(true);
    const result = await runIdentityCeremony({
      io: cap.io,
      prompter: scripted(["", "贾维斯"]), // Y 仪式 + 自定义名
      memory,
      today: () => TODAY,
    });
    expect(result.ran).toBe(true);
    expect(result.name).toBe("贾维斯");
    const out = cap.text();
    expect(out).toContain("你好，我是贾维斯，今天诞生");
    expect(out).toContain("工作纪律「verify_sop」过审入树");
    expect(out).toContain(`诞生日 ${TODAY}`);

    // 身份落 L1 托管区；≤30 行铁律保持。
    expect(memory.readIdentity()).toEqual({ name: "贾维斯", bornAt: TODAY });
    const l1 = fs.readFileSync(path.join(globalRoot, L1_FILE_NAME), "utf-8");
    expect(l1).toContain("penglai:identity:start");
    expect(l1.split("\n").length).toBeLessThanOrEqual(MEMORY_L1_MAX_LINES);
  });

  it("默认名：回车即蓬莱", async () => {
    const cap = captureIo(true);
    const result = await runIdentityCeremony({
      io: cap.io,
      prompter: scripted(["", ""]),
      memory,
      today: () => TODAY,
    });
    expect(result.name).toBe("蓬莱");
    expect(memory.readIdentity()?.name).toBe("蓬莱");
  });

  it("可跳过：答 n 不写身份不播种", async () => {
    const cap = captureIo(true);
    const result = await runIdentityCeremony({
      io: cap.io,
      prompter: scripted(["n"]),
      memory,
      today: () => TODAY,
    });
    expect(result.ran).toBe(false);
    expect(result.skipped).toBe(true);
    expect(cap.text()).toContain("改天再办");
    expect(memory.readIdentity()).toBeNull();
    expect(memory.listSops()).toEqual([]);
  });

  it("非 tty 降级：一行指引，不挂起不写入", async () => {
    const cap = captureIo(false);
    const result = await runIdentityCeremony({
      io: cap.io,
      prompter: null,
      memory,
      today: () => TODAY,
    });
    expect(result.ran).toBe(false);
    expect(cap.text()).toContain("非交互环境");
    expect(memory.readIdentity()).toBeNull();
    expect(memory.listSops()).toEqual([]);
  });

  it("二次运行不重复仪式（身份已在直接返回）", async () => {
    const first = captureIo(true);
    await runIdentityCeremony({
      io: first.io,
      prompter: scripted(["", "蓬莱"]),
      memory,
      today: () => TODAY,
    });
    const second = captureIo(true);
    const again = await runIdentityCeremony({
      io: second.io,
      prompter: scripted([]), // 若被提问会抛错
      memory,
      today: () => TODAY,
    });
    expect(again.ran).toBe(false);
    expect(again.existingName).toBe("蓬莱");
    expect(second.text()).not.toContain("诞生仪式");
    expect(memory.listSops()).toHaveLength(2); // 种子未被重复写入
  });
});

// ── 身份进系统提示词 ───────────────────────────────────────────

describe("身份注入系统提示词", () => {
  it("有身份：首行带名字与诞生日（floating+anchored 一致）", () => {
    memory.writeIdentity({ name: "贾维斯", bornAt: TODAY });
    const chat = buildSystemPrompt({ projectAnchored: false, workspaceRoot: "/tmp/x", memory });
    expect(chat.split("\n")[0]).toContain("贾维斯");
    expect(chat.split("\n")[0]).toContain(TODAY);
    const work = buildSystemPrompt({ projectAnchored: true, workspaceRoot: "/tmp/x", memory });
    expect(work.split("\n")[0]).toContain("贾维斯");
  });

  it("无身份：保持种子默认首行（向后兼容）", () => {
    const chat = buildSystemPrompt({ projectAnchored: false, workspaceRoot: "/tmp/x", memory });
    expect(chat.split("\n")[0]).toContain("You are Penglai");
  });
});
