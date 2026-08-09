/**
 * 0.3 → 0.4 迁移计划（纯数据，不写盘）。
 *
 * 三步：探测 0.3 源目录（detect03SourceDir）→ 扫描源（scan03Source：mykey.py
 * 模型/渠道配置 + memory/ 记忆资产）→ 对照 0.4 目标现状出计划
 * （buildMigrationPlan：每项 create / skip-unchanged / conflict-skip /
 * archive + 中文理由）。SOP 候选在计划阶段就过蒸馏环审计规则表
 * （auditCandidateSop，纯规则、无 LLM 位）——过审入树，未过归档并说明。
 *
 * 幂等是计划层的属性：同一源、同一目标，两次计划结果一致；第二次运行
 * 全部 skip-unchanged，零写入零备份。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { auditCandidateSop, type AuditVerdict } from "../distill/audit.js";
import {
  loadPersistedProfiles,
  type PersistedProfileEntry,
} from "../profiles-store.js";
import { loadChannelConfig, type FeishuChannelConfig } from "../feishu/config.js";
import { MemoryStore, L1_FILE_NAME, L1_SEED } from "../memory.js";
import { MEMORY_L1_MAX_LINES } from "../policy.js";
import { CATALOG } from "../providers/catalog.js";
import { parseMykeyAssignments } from "./mykey-parser.js";

// ── 常量 ───────────────────────────────────────────────────────

/** 迁移写入 SOP 的独立 Host receipt provenance。 */
export const MIGRATION_PROVENANCE = {
  sourceKind: "migrate",
  sourceTaskId: null,
  sourceRunId: null,
  sourceRef: "migration:0.3-memory-import",
  evidenceId: null,
  auditedBy: "rules+migrate-03",
} as const;

/** L1 里 0.3 迁移区的托管标记。 */
export const MIGRATION_SECTION_TAG = "migration-03";

/** 归档笔记名。 */
export const ARCHIVE_FACTS_NOTE = "archive03-facts";
export const ARCHIVE_L1_NOTE = "archive03-l1-insight";
export const ARCHIVE_SOP_PREFIX = "archive03-sop-";

/** 0.4 本期唯一支持的渠道。 */
const SUPPORTED_CHANNELS = new Set(["feishu"]);

// ── 计划数据形状 ───────────────────────────────────────────────

export interface SkipEntry {
  /** 区域：模型档案 / 记忆 / 渠道。 */
  area: "模型档案" | "记忆" | "渠道";
  item: string;
  reason: string;
}

export interface ProfilePlanEntry {
  action: "create" | "skip-unchanged" | "conflict-skip";
  id: string;
  label: string;
  provider: string;
  baseUrl: string;
  model: string;
  /** 真实 key——只进 profiles.json（0600），绝不进报告/日志。 */
  apiKey: string;
  /** 报告用掩码（sk-t…0000）。 */
  maskedKey: string;
  /** 0.3 侧变量名（溯源）。 */
  sourceVar: string;
  reason?: string;
}

export interface ChannelPlanEntry {
  action: "create" | "skip-unchanged" | "conflict-skip" | "none";
  appId: string;
  appSecret: string;
  maskedAppId: string;
  maskedSecret: string;
  reason?: string;
}

export interface WhitelistPlanEntry {
  action: "create" | "skip-unchanged";
  openId: string;
}

export interface SopPlanEntry {
  action: "plant" | "archive" | "skip-unchanged" | "conflict-skip";
  name: string;
  sourcePath: string;
  content: string;
  audit: AuditVerdict;
  /** archive 时的归档笔记名。 */
  archiveName?: string;
  /** archive 时的归档笔记全文（plan 生成，apply 落盘；幂等比对用）。 */
  archiveContent?: string;
  reason?: string;
}

export interface MemoryPlan {
  insightAction:
    | "l1-section"
    | "l1-section-truncated"
    | "skip-unchanged"
    | "skip-empty"
    | "archive-only";
  /** 写入 L1 迁移区的内容行（已按 ≤30 行铁律裁剪）。 */
  insightLines: string[];
  /** 0.3 L1 全文（截断/仅归档时落归档笔记）。 */
  insightFull: string[];
  insightReason?: string;
  factsAction: "archive" | "archive-update" | "skip-unchanged" | "skip-empty";
  factsContent: string;
  factsReason?: string;
  /** 0.3 没有按工作区组织的项目记忆——如实说明。 */
  projectNote: string;
  sops: SopPlanEntry[];
}

export interface MigrationPlan {
  sourceDir: string;
  dataDir: string;
  profiles: ProfilePlanEntry[];
  channel: ChannelPlanEntry;
  whitelist: WhitelistPlanEntry[];
  memory: MemoryPlan;
  skips: SkipEntry[];
}

/** 计划里是否含有任何写入动作（无写入 → 不备份、报告全跳过）。 */
export function planHasWrites(plan: MigrationPlan): boolean {
  return (
    plan.profiles.some((p) => p.action === "create") ||
    plan.channel.action === "create" ||
    plan.whitelist.some((w) => w.action === "create") ||
    plan.memory.sops.some((s) => s.action === "plant" || s.action === "archive") ||
    plan.memory.insightAction === "l1-section" ||
    plan.memory.insightAction === "l1-section-truncated" ||
    plan.memory.insightAction === "archive-only" ||
    plan.memory.factsAction === "archive" ||
    plan.memory.factsAction === "archive-update"
  );
}

// ── 小工具 ─────────────────────────────────────────────────────

/** 秘钥掩码：前 4 … 后 4；短 key 全掩（绝不回显全文）。 */
export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 12) return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
  if (trimmed.length > 0) return `****（长度 ${trimmed.length}）`;
  return "（空）";
}

/** 档案 id：0.3 name/变量名 → 0.4 合法 id（小写、仅 [a-z0-9_-]）。 */
export function sanitizeProfileId(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "migrated-03";
}

/**
 * 0.3 apibase → 0.4 baseUrl：0.3 约定自动补 /v1/chat/completions，0.4 约定
 * baseUrl 是不含 /chat/completions 的前缀（host 调 {baseUrl}/chat/completions）。
 * 逆操作：去掉尾部 /chat/completions 与查询串，保留 …/v1。
 */
export function normalize03BaseUrl(apibase: string): string {
  let url = apibase.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  url = url.replace(/\/chat\/completions$/i, "").replace(/\/+$/, "");
  return url;
}

/** 按 baseUrl host 猜供应商（目录内命中返回 provider id，否则 custom）。 */
export function providerForBaseUrl(baseUrl: string): string {
  let host = "";
  try {
    host = new URL(baseUrl).host;
  } catch {
    return "custom";
  }
  for (const [id, entry] of Object.entries(CATALOG.providers)) {
    for (const mode of Object.values(entry.billing)) {
      for (const candidate of [mode.base_url, mode.base_url_anthropic]) {
        if (!candidate) continue;
        try {
          if (new URL(candidate).host === host) return id;
        } catch {
          /* 目录端点非法时忽略该条 */
        }
      }
    }
  }
  return "custom";
}

// ── 0.3 源目录探测 ─────────────────────────────────────────────

export interface SourceDirProbe {
  dir: string;
  /** 命中方式（报告用）：--from / 环境变量 / 默认候选。 */
  how: string;
}

/** 一个目录「像 0.3 家」的判据：存在 mykey.py（0.3 配置即数据）。 */
export function looksLike03Home(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, "mykey.py")).isFile();
  } catch {
    return false;
  }
}

/**
 * 探测 0.3 源目录：--from 显式指定 > PENGLAI_03_DIR 环境变量 > 默认候选
 * （~/.penglai、~/PenglaiAgent、~/GenericAgent、~/penglai）。全部未命中
 * 返回 null（调用方给引导）。显式 --from 不像 0.3 家时报错而非静默换人。
 */
export function detect03SourceDir(from?: string): SourceDirProbe | null {
  if (from) {
    const resolved = path.resolve(from.replace(/^~(?=\/|$)/, os.homedir()));
    if (!looksLike03Home(resolved)) {
      throw new Error(
        `--from 指定的目录不像 0.3 数据目录（未找到 mykey.py）：${resolved}`,
      );
    }
    return { dir: resolved, how: "--from" };
  }
  const envDir = process.env.PENGLAI_03_DIR?.trim();
  const candidates: Array<{ dir: string; how: string }> = [];
  if (envDir) candidates.push({ dir: envDir, how: "PENGLAI_03_DIR" });
  candidates.push(
    { dir: path.join(os.homedir(), ".penglai"), how: "~/.penglai" },
    { dir: path.join(os.homedir(), "PenglaiAgent"), how: "~/PenglaiAgent" },
    { dir: path.join(os.homedir(), "GenericAgent"), how: "~/GenericAgent" },
    { dir: path.join(os.homedir(), "penglai"), how: "~/penglai" },
  );
  for (const candidate of candidates) {
    if (looksLike03Home(candidate.dir)) return candidate;
  }
  return null;
}

// ── 0.3 源扫描 ─────────────────────────────────────────────────

export interface SourceProfile {
  sourceVar: string;
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface SourceScan {
  profiles: SourceProfile[];
  feishu: { appId: string; appSecret: string; allowedUsers: string[] } | null;
  /** 0.3 L1（global_mem_insight.txt）与 L2（global_mem.txt）原文行。 */
  insightLines: string[];
  factsContent: string;
  /** memory/ 面层的 .md SOP 候选（文件名去 .md → SOP 名）。 */
  sopFiles: Array<{ name: string; path: string; content: string }>;
  skips: SkipEntry[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 0.3 变量路由规则（agentmain.py 只扫变量名含 api/config/cookie 的条目）：
 * 返回该变量是否是会话配置。
 */
function isSessionVar(varName: string): boolean {
  const lower = varName.toLowerCase();
  return lower.includes("api") || lower.includes("config") || lower.includes("cookie");
}

/** 扫描 0.3 源目录（只读，绝不写）。 */
export function scan03Source(dir: string): SourceScan {
  const skips: SkipEntry[] = [];
  const mykeyPath = path.join(dir, "mykey.py");
  const parsed = parseMykeyAssignments(fs.readFileSync(mykeyPath, "utf-8"));
  for (const name of parsed.unparsable) {
    skips.push({
      area: "模型档案",
      item: name,
      reason: "值不是纯字面量（函数调用/运算式），无法安全解析，未迁移",
    });
  }

  const profiles: SourceProfile[] = [];
  let feishu: SourceScan["feishu"] = null;

  for (const [varName, value] of parsed.values) {
    const lower = varName.toLowerCase();

    // ── 渠道（飞书先行；其他平台 0.4 本期不支持） ──
    if (lower === "fs_app_id" || lower === "fs_app_secret" || lower === "fs_allowed_users") {
      continue; // 与另一半合并，循环后统一组装
    }
    if (
      /^(tg|qq|wechat|wecom|dingtalk|discord)_/.test(lower) ||
      lower === "langfuse_config"
    ) {
      const platform = lower.split("_")[0];
      if (!SUPPORTED_CHANNELS.has(platform)) {
        skips.push({
          area: "渠道",
          item: varName,
          reason: `0.4 本期仅支持飞书渠道，${platform} 配置未迁移（发布后排期）`,
        });
      }
      continue;
    }

    if (!isSessionVar(varName)) continue; // proxy 等杂项不迁移
    const dict = asRecord(value);
    if (!dict) continue; // 非 dict 的 api/config 变量（如 str token）上面已分类

    // ── mixin 故障转移：0.4 无对应机制 ──
    if (lower.includes("mixin")) {
      const refs = Array.isArray(dict.llm_nos) ? dict.llm_nos.length : 0;
      skips.push({
        area: "模型档案",
        item: varName,
        reason:
          `mixin 故障转移在 0.4 无对应机制（其引用的 ${refs} 个 session 已按个体迁移）；` +
          "0.4 用多档案 + config list 选择",
      });
      continue;
    }

    // ── CC/Anthropic 原生协议端点：不映射 0.4 OpenAI 兼容档案 ──
    const isAnthropicNative =
      (lower.includes("native") && lower.includes("claude")) ||
      dict.fake_cc_system_prompt === true ||
      asString(dict.apikey).startsWith("sk-ant-");
    if (isAnthropicNative) {
      skips.push({
        area: "模型档案",
        item: `${varName}（${asString(dict.name) || asString(dict.model) || "?"}）`,
        reason:
          "0.3 CC/Anthropic 原生协议端点不直接映射 0.4 的 OpenAI 兼容档案；" +
          "请用 `penglai setup` 重配（目录内多家供应商含 Anthropic 协议计费模式）",
      });
      continue;
    }

    // ── 常规会话配置 → 0.4 档案 ──
    const apiKey = asString(dict.apikey);
    const apibase = asString(dict.apibase);
    const model = asString(dict.model);
    if (!apiKey || !apibase || !model) {
      const missing = [
        !apiKey && "apikey",
        !apibase && "apibase",
        !model && "model",
      ]
        .filter(Boolean)
        .join("/");
      skips.push({
        area: "模型档案",
        item: varName,
        reason: `缺 ${missing}（0.3 里可能是占位/半成品），未迁移`,
      });
      continue;
    }
    if (/your-|<.*>|xxxx/i.test(apiKey)) {
      skips.push({
        area: "模型档案",
        item: varName,
        reason: "apikey 是模板占位符，未迁移",
      });
      continue;
    }
    profiles.push({
      sourceVar: varName,
      name: asString(dict.name) || varName,
      model,
      baseUrl: normalize03BaseUrl(apibase),
      apiKey,
    });
  }

  // ── 飞书渠道组装 ──
  const fsAppId = asString(parsed.values.get("fs_app_id"));
  const fsAppSecret = asString(parsed.values.get("fs_app_secret"));
  const fsAllowedRaw = parsed.values.get("fs_allowed_users");
  if (fsAppId || fsAppSecret) {
    if (fsAppId && fsAppSecret && !/your-|xxxx/i.test(fsAppSecret)) {
      const allowedUsers = Array.isArray(fsAllowedRaw)
        ? fsAllowedRaw.map((u) => String(u).trim()).filter(Boolean)
        : [];
      feishu = { appId: fsAppId, appSecret: fsAppSecret, allowedUsers };
    } else {
      skips.push({
        area: "渠道",
        item: "fs_app_id/fs_app_secret",
        reason: "飞书配置不完整或是模板占位符，未迁移",
      });
    }
  }

  // ── memory/ 扫描 ──
  const memoryDir = path.join(dir, "memory");
  let insightLines: string[] = [];
  let factsContent = "";
  const sopFiles: SourceScan["sopFiles"] = [];
  if (fs.existsSync(memoryDir)) {
    const readText = (name: string): string => {
      try {
        return fs.readFileSync(path.join(memoryDir, name), "utf-8");
      } catch {
        return "";
      }
    };
    insightLines = readText("global_mem_insight.txt")
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== "");
    factsContent = readText("global_mem.txt").trim();

    for (const entry of fs.readdirSync(memoryDir, { withFileTypes: true })) {
      if (entry.name === "global_mem.txt" || entry.name === "global_mem_insight.txt") continue;
      if (entry.name === "__pycache__") continue;
      if (entry.isDirectory()) {
        skips.push({
          area: "记忆",
          item: `memory/${entry.name}/`,
          reason:
            entry.name === "L4_raw_sessions"
              ? "0.3 原始会话日志属私密历史数据，不迁移（0.4 由 pi-sessions 自管理）"
              : "子目录结构不整体迁移；面层 .md 文档已单独处理，如需其中文件请手工归档",
        });
        continue;
      }
      if (entry.name.endsWith(".md")) {
        const name = entry.name.slice(0, -3);
        sopFiles.push({
          name,
          path: path.join(memoryDir, entry.name),
          content: readText(entry.name).trim(),
        });
        continue;
      }
      skips.push({
        area: "记忆",
        item: `memory/${entry.name}`,
        reason: entry.name.endsWith(".py")
          ? "0.3 代码文件不迁移（0.4 工具面与技能形态不同）"
          : "未识别类型，未迁移（如需请手工归档）",
      });
    }
  } else {
    skips.push({ area: "记忆", item: "memory/", reason: "源目录无 memory/ 目录，仅迁移配置" });
  }

  return { profiles, feishu, insightLines, factsContent, sopFiles, skips };
}

// ── 计划构建（对照 0.4 目标现状） ──────────────────────────────

export interface BuildPlanContext {
  dataDir: string;
  memory: MemoryStore;
  /** 现有飞书白名单 open_id 集（product.db 直读，调用方备好）。 */
  existingWhitelist: ReadonlySet<string>;
}

function sameProfile(a: PersistedProfileEntry, b: { provider: string; baseUrl: string; model: string; apiKey: string }): boolean {
  return (
    a.provider === b.provider &&
    a.baseUrl === b.baseUrl &&
    a.model === b.model &&
    (a.apiKey ?? "") === b.apiKey
  );
}

/** 计划构建是 async 的：SOP 候选要过审计规则表。 */
export async function buildMigrationPlan(
  sourceDir: string,
  scan: SourceScan,
  ctx: BuildPlanContext,
): Promise<MigrationPlan> {
  const skips: SkipEntry[] = [...scan.skips];
  const existingProfiles = loadPersistedProfiles(ctx.dataDir);

  // ── 模型档案 ──
  const profiles: ProfilePlanEntry[] = [];
  const seenIds = new Set<string>();
  for (const source of scan.profiles) {
    const id = sanitizeProfileId(source.name);
    const provider = providerForBaseUrl(source.baseUrl);
    const entry: ProfilePlanEntry = {
      action: "create",
      id,
      label: source.name,
      provider,
      baseUrl: source.baseUrl,
      model: source.model,
      apiKey: source.apiKey,
      maskedKey: maskSecret(source.apiKey),
      sourceVar: source.sourceVar,
    };
    if (seenIds.has(id)) {
      skips.push({
        area: "模型档案",
        item: `${source.name}（${source.sourceVar}）`,
        reason: `档案 id ${id} 与本次另一迁移项重名，后者未迁移（请手工 config add）`,
      });
      continue;
    }
    seenIds.add(id);
    const existing = existingProfiles.find((p) => p.id === id);
    if (existing) {
      if (sameProfile(existing, entry)) {
        entry.action = "skip-unchanged";
        entry.reason = "已迁移，内容一致";
      } else {
        entry.action = "conflict-skip";
        entry.reason =
          `档案 id「${id}」已存在且内容不同，未覆盖（保守：不改动 owner 既有档案；` +
          "如确认要换，先 `penglai config remove` 或手工编辑 profiles.json 后重迁）";
      }
    }
    profiles.push(entry);
  }

  // ── 飞书渠道 ──
  let channel: ChannelPlanEntry = {
    action: "none",
    appId: "",
    appSecret: "",
    maskedAppId: "",
    maskedSecret: "",
    reason: "0.3 未配置飞书",
  };
  const whitelist: WhitelistPlanEntry[] = [];
  if (scan.feishu) {
    const existingChannel: FeishuChannelConfig | null = loadChannelConfig(ctx.dataDir);
    channel = {
      action: "create",
      appId: scan.feishu.appId,
      appSecret: scan.feishu.appSecret,
      maskedAppId: maskSecret(scan.feishu.appId),
      maskedSecret: maskSecret(scan.feishu.appSecret),
    };
    if (existingChannel) {
      if (
        existingChannel.appId === scan.feishu.appId &&
        existingChannel.appSecret === scan.feishu.appSecret
      ) {
        channel.action = "skip-unchanged";
        channel.reason = "已迁移，内容一致";
      } else {
        channel.action = "conflict-skip";
        channel.reason =
          "channels.json 已存在不同的飞书配置，未覆盖（保守：如需更换请先 `penglai channel disable` 并删除 channels.json 后重迁）";
      }
    }
    for (const openId of scan.feishu.allowedUsers) {
      if (openId === "*") {
        skips.push({
          area: "渠道",
          item: "fs_allowed_users=['*']",
          reason: "0.4 白名单无通配符（默认拒绝、按 open_id 逐个放行），通配条目未迁移",
        });
        continue;
      }
      whitelist.push({
        action: ctx.existingWhitelist.has(openId) ? "skip-unchanged" : "create",
        openId,
      });
    }
  }

  // ── 记忆：L1 迁移区 + 事实归档 + SOP 候选 ──
  // 注意：计划阶段绝不写盘（dry-run 零副作用）——不调 ensureGlobalLayout。
  const sectionHeader = `## 0.3 记忆迁移（host 托管；源 ${sourceDir}）`;
  const existingSection = ctx.memory.readManagedSection(MIGRATION_SECTION_TAG);
  const l1File = path.join(ctx.memory.globalRoot, L1_FILE_NAME);
  // L1 尚不存在时，执行端 ensureGlobalLayout 会写入种子——预算按种子行数计。
  const l1LineCount = fs.existsSync(l1File)
    ? fs.readFileSync(l1File, "utf-8").replace(/\n+$/, "").split("\n").length
    : L1_SEED.trimEnd().split("\n").length;

  const memoryPlan: MemoryPlan = {
    insightAction: "skip-empty",
    insightLines: [],
    insightFull: scan.insightLines,
    factsAction: "skip-empty",
    factsContent: scan.factsContent,
    projectNote:
      "0.3 的记忆不分工作区（全部集中在仓库 memory/），无项目记忆可映射；" +
      "全局记录已按上文归档，项目记忆自 0.4 起在各项目 .penglai/memory/ 全新积累",
    sops: [],
  };

  // ── SOP 候选：过审计 → 入树；未过 → 归档 + 理由 ──
  // （先于 L1 预算评估：入树 SOP 会让 L1 长出索引区，预算须为其预留行数。）
  const sopEntries: SopPlanEntry[] = [];
  for (const sop of scan.sopFiles) {
    const audit = await auditCandidateSop(sop.content);
    const entry: SopPlanEntry = {
      action: "plant",
      name: sop.name,
      sourcePath: sop.path,
      content: sop.content,
      audit,
    };
    let existing = "";
    try {
      existing = ctx.memory.readSop(sop.name);
    } catch {
      /* 不在树中 */
    }
    if (existing) {
      // 比对时剥掉首行 provenance 头（penglai-sop 注释行）。
      const existingBody = existing.replace(/^<!-- penglai-sop:[^>]*-->\n/, "").trim();
      if (existingBody === sop.content.trim()) {
        entry.action = "skip-unchanged";
        entry.reason = "已迁移，内容一致";
      } else {
        entry.action = "conflict-skip";
        entry.reason =
          `SOP「${sop.name}」已在技能树中且内容不同，未覆盖（可 \`penglai memory sop remove ${sop.name}\` 后重迁）`;
      }
    } else if (!audit.pass) {
      entry.archiveName = `${ARCHIVE_SOP_PREFIX}${sop.name}`;
      const rules = audit.findings
        .map((f) => `- ${f.ruleId}（${f.ruleName}）：${f.excerpt}`)
        .join("\n");
      entry.archiveContent =
        `# 0.3 SOP 归档：${sop.name}（审计未过，未入技能树）\n\n` +
        `> 来源：${sop.path}；penglai migrate。审计命中：\n${rules}\n\n` +
        `---\n\n${sop.content}\n`;
      let existingArchive = "";
      try {
        existingArchive = ctx.memory.readGlobalNote(entry.archiveName);
      } catch {
        /* 未归档过 */
      }
      if (existingArchive.trim() === entry.archiveContent.trim()) {
        entry.action = "skip-unchanged";
        entry.reason = "已归档（审计未过），内容一致";
      } else {
        entry.action = "archive";
        const ruleIds = audit.findings.map((f) => `${f.ruleId}（${f.excerpt}）`).join("；");
        entry.reason = `审计未过（${ruleIds}）→ 归档 ${entry.archiveName}，不入技能树`;
      }
    }
    sopEntries.push(entry);
  }
  memoryPlan.sops = sopEntries;

  // L1 SOP 索引区预留：迁移区写定后，入树 SOP 会让 L1 追加索引段
  // （1 空行 + 2 标记 + 指针行 ≤8 + 溢出 1 行）——预留后迁移区不把它顶破 30 行。
  const existingSopCount = ctx.memory.listSops().length;
  const plantedSopCount = sopEntries.filter((s) => s.action === "plant").length;
  const finalSopCount = existingSopCount + plantedSopCount;
  const sopIndexReserve =
    finalSopCount > 0 ? 3 + Math.min(finalSopCount, 8) + (finalSopCount > 8 ? 1 : 0) : 0;

  if (scan.insightLines.length > 0) {
    const desiredLines = [sectionHeader, ...scan.insightLines];
    const unchanged =
      existingSection !== null &&
      existingSection.join("\n").trim() === desiredLines.join("\n").trim();
    if (unchanged) {
      memoryPlan.insightAction = "skip-unchanged";
      memoryPlan.insightReason = "已迁移，内容一致";
    } else {
      // ≤30 行铁律预算（与 readGlobalL1/writeManagedSection 同一口径：原始
      // split ≤30 = 正文 ≤29 + 尾换行）：现有正文（扣旧迁移区）+ 1 分隔空行
      // + 2 标记行 + 迁移区内容 + SOP 索引区预留 ≤ 29。
      const oldSectionLines = existingSection ? existingSection.length + 2 : 0;
      const baseLines = Math.max(0, l1LineCount - oldSectionLines);
      const budget = (MEMORY_L1_MAX_LINES - 4) - baseLines - sopIndexReserve; // 内容行（含标题）上限
      if (desiredLines.length <= budget) {
        memoryPlan.insightAction = "l1-section";
        memoryPlan.insightLines = desiredLines;
        if (existingSection) memoryPlan.insightReason = "更新既有迁移区（源内容有变化）";
      } else if (budget >= 2) {
        memoryPlan.insightAction = "l1-section-truncated";
        memoryPlan.insightLines = [
          sectionHeader,
          ...scan.insightLines.slice(0, Math.max(0, budget - 2)),
          `…（0.3 L1 共 ${scan.insightLines.length} 行，超 ≤30 行铁律；全文见归档笔记 ${ARCHIVE_L1_NOTE}）`,
        ];
        memoryPlan.insightReason = `L1 铁律：仅 ${Math.max(0, budget - 2)} 行入 L1，全文入归档区`;
      } else {
        memoryPlan.insightAction = "archive-only";
        memoryPlan.insightReason = `L1 已无迁移区预算（≤30 行铁律），全文入归档笔记 ${ARCHIVE_L1_NOTE}`;
      }
    }
  }

  if (scan.factsContent.length > 0) {
    const factsNote =
      `# 0.3 全局事实库归档（global_mem.txt）\n\n` +
      `> 来源：${path.join(sourceDir, "memory", "global_mem.txt")}；penglai migrate 原样归档，未逐条核验时效。\n\n` +
      scan.factsContent +
      "\n";
    memoryPlan.factsContent = factsNote;
    let existingFacts = "";
    try {
      existingFacts = ctx.memory.readGlobalNote(ARCHIVE_FACTS_NOTE);
    } catch {
      /* 不存在即新建 */
    }
    if (existingFacts.trim() === factsNote.trim()) {
      memoryPlan.factsAction = "skip-unchanged";
      memoryPlan.factsReason = "已迁移，内容一致";
    } else {
      memoryPlan.factsAction = existingFacts ? "archive-update" : "archive";
      if (existingFacts) memoryPlan.factsReason = "源事实库有变化，更新归档（旧版已备份）";
    }
  }

  return {
    sourceDir,
    dataDir: ctx.dataDir,
    profiles,
    channel,
    whitelist,
    memory: memoryPlan,
    skips,
  };
}
