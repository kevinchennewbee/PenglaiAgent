/**
 * 0.3 → 0.4 迁移工具测试（fixture 端到端）。
 *
 * fixture `fixtures/03home/` 是 0.3 格式的虚构数据目录原料（mykey.py 按
 * mykey_template.py 格式构造、全假凭证；memory/ 含 0.3 真实 SOP 样例
 * verify_sop / penglai_compress_sop 与虚构 L1/L2）——绝不读 owner
 * 真实私密数据。仓库中的 Python 文件名加 `.fixture` 后缀；测试仅在
 * 系统临时目录还原旧文件名，不执行这些内容。
 *
 * 覆盖：探测 / 扫描分类 / 计划幂等决策 / 执行（0600 + 备份 + 报告掩码）/
 * 幂等复跑 / 冲突跳过 / L1 ≤30 行铁律（裁剪+归档）/ 回滚 / CLI 命令面
 * （dry-run、非 tty 降级、交互确认、rollback）。
 */

import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATABASE_SCHEMA_VERSION } from "@penglai/protocol";
import {
  buildMigrationPlan,
  ARCHIVE_FACTS_NOTE,
  detect03SourceDir,
  looksLike03Home,
  maskSecret,
  normalize03BaseUrl,
  planHasWrites,
  sanitizeProfileId,
  scan03Source,
} from "../src/migrate/plan.js";
import {
  applyMigration,
  latestBackupDir,
  readExistingWhitelist,
  readMigrationJournal,
  rollbackMigration,
} from "../src/migrate/apply.js";
import { cmdMigrate } from "../src/cli/migrate-cmd.js";
import { MemoryStore } from "../src/memory.js";
import { loadPersistedProfiles, savePersistedProfile } from "../src/profiles-store.js";
import { loadChannelConfig } from "../src/feishu/config.js";
import { ProductStore } from "../src/storage/product-store.js";
import { acquireDataDirOperationLock } from "../src/migrate/operation-lock.js";
import type { CliIO } from "../src/cli/format.js";

const FIXTURE_SOURCE_03 = path.join(__dirname, "fixtures", "03home");
let fixtureRoot = "";
let FIXTURE_03 = "";
const CLOCK = () => new Date("2026-07-29T15:30:00");

let dataDir = "";

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

function memoryAt(dir: string): MemoryStore {
  return new MemoryStore(path.join(dir, "memory", "global"));
}

interface CapturedDataState {
  entries: Array<[string, string]>;
  databaseExisted: boolean;
  whitelistTableExisted: boolean;
  whitelist: string[];
}

function captureDataState(dir: string): CapturedDataState {
  const entries: Array<[string, string]> = [];
  const visit = (current: string): void => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(dir, absolute);
      if (relative === "migrate-backup" || relative.startsWith(`migrate-backup${path.sep}`)) continue;
      if (["product.db", "product.db-wal", "product.db-shm"].includes(relative)) continue;
      if (entry.isDirectory()) {
        entries.push([relative, `dir:${fs.statSync(absolute).mode & 0o777}`]);
        visit(absolute);
      } else {
        entries.push([
          relative,
          `file:${fs.statSync(absolute).mode & 0o777}:${crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")}`,
        ]);
      }
    }
  };
  visit(dir);
  const database = path.join(dir, "product.db");
  let whitelistTableExisted = false;
  if (fs.existsSync(database)) {
    const db = new DatabaseSync(database);
    try {
      whitelistTableExisted = Boolean(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='channel_identities'").get(),
      );
    } finally {
      db.close();
    }
  }
  return {
    entries: entries.sort(([a], [b]) => a.localeCompare(b)),
    databaseExisted: fs.existsSync(database),
    whitelistTableExisted,
    whitelist: [...readExistingWhitelist(dir)].sort(),
  };
}

function seedRecoveryFixture(dir: string): CapturedDataState {
  savePersistedProfile(dir, {
    id: "owner-existing",
    label: "owner existing",
    provider: "custom",
    baseUrl: "https://owner.example.com/v1",
    model: "owner-model",
    apiKeyEnv: "OWNER_KEY",
  });
  fs.writeFileSync(path.join(dir, "channels.json"), "{ owner-corrupt-config }\n", {
    mode: 0o600,
  });
  const memory = memoryAt(dir);
  memory.ensureGlobalLayout();
  memory.writeGlobalArchive(ARCHIVE_FACTS_NOTE, "# owner archive before migration\n");
  fs.writeFileSync(memory.sopMigrationAuthorityFile(), `${"a".repeat(64)}\n`, { mode: 0o600 });

  const store = new ProductStore(path.join(dir, "product.db"), {
    recoverInterruptedRuns: false,
  });
  try {
    store.allowChannelIdentity({
      channel: "feishu",
      channelUserId: "ou_owner_existing",
      identity: "owner",
      note: "owner row",
    });
  } finally {
    store.close();
  }
  return captureDataState(dir);
}

async function planFixture(dir = dataDir) {
  const scan = scan03Source(FIXTURE_03);
  return buildMigrationPlan(FIXTURE_03, scan, {
    dataDir: dir,
    memory: memoryAt(dir),
    existingWhitelist: readExistingWhitelist(dir),
  });
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-migrate-test-"));
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-03-fixture-"));
  FIXTURE_03 = path.join(fixtureRoot, "03home");
  fs.cpSync(FIXTURE_SOURCE_03, FIXTURE_03, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}__pycache__`),
  });
  for (const [source, target] of [
    ["legacy-config.fixture", "mykey.py"],
    ["legacy-template.fixture", "mykey_template_full.py"],
    ["memory/legacy-keychain.fixture", "memory/keychain.py"],
  ]) {
    fs.renameSync(path.join(FIXTURE_03, source), path.join(FIXTURE_03, target));
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

// ── 探测与小工具 ───────────────────────────────────────────────

describe("0.3 源目录探测", () => {
  it("判据：目录内有 mykey.py 才算 0.3 家", () => {
    expect(looksLike03Home(FIXTURE_03)).toBe(true);
    expect(looksLike03Home(dataDir)).toBe(false);
  });

  it("--from 显式指定优先；不像 0.3 家时报错而非静默换人", () => {
    expect(detect03SourceDir(FIXTURE_03)?.dir).toBe(FIXTURE_03);
    expect(() => detect03SourceDir(dataDir)).toThrow(/mykey\.py/);
  });

  it("PENGLAI_03_DIR 环境变量参与默认探测", () => {
    vi.stubEnv("PENGLAI_03_DIR", FIXTURE_03);
    const probe = detect03SourceDir();
    expect(probe?.dir).toBe(FIXTURE_03);
    expect(probe?.how).toBe("PENGLAI_03_DIR");
  });
});

describe("掩码与规范化", () => {
  it("maskSecret：长 key 首尾掩码，短 key 全掩，绝不回显全文", () => {
    const masked = maskSecret("sk-fixture0000000000000000000000deadbeef");
    expect(masked).toBe("sk-f…beef");
    expect(maskSecret("abc")).toBe("****（长度 3）");
    expect(maskSecret("")).toBe("（空）");
  });

  it("normalize03BaseUrl：剥 /chat/completions 与查询串", () => {
    expect(normalize03BaseUrl("https://api.deepseek.com")).toBe("https://api.deepseek.com");
    expect(normalize03BaseUrl("https://r.example.com/v1/chat/completions")).toBe("https://r.example.com/v1");
    expect(normalize03BaseUrl("https://r.example.com/v1/chat/completions?beta=true")).toBe("https://r.example.com/v1");
  });

  it("sanitizeProfileId：小写合法字符，空名兜底", () => {
    expect(sanitizeProfileId("GPT Native")).toBe("gpt-native");
    expect(sanitizeProfileId("ds-main")).toBe("ds-main");
    expect(sanitizeProfileId("***")).toBe("migrated-03");
  });
});

// ── 扫描分类 ───────────────────────────────────────────────────

describe("scan03Source: mykey.py 与 memory/ 分类", () => {
  it("可迁移条目 / 协议不兼容 / mixin / 半成品 / 占位 / 非字面量各归其位", () => {
    const scan = scan03Source(FIXTURE_03);
    expect(scan.profiles.map((p) => p.name).sort()).toEqual(["ds-main", "relay-gpt"]);
    expect(scan.profiles.find((p) => p.name === "relay-gpt")?.baseUrl).toBe("https://relay.example.com/v1");
    const skipItems = scan.skips.map((s) => s.item);
    expect(skipItems).toContain("weird_config");
    expect(skipItems).toContain("mixin_config");
    expect(skipItems.some((i) => i.includes("cc-relay-1"))).toBe(true);
    expect(skipItems).toContain("oai_config_halfdone");
    expect(skipItems).toContain("oai_config_placeholder");
  });

  it("渠道：飞书组装完整；tg 等其他平台跳过并说明", () => {
    const scan = scan03Source(FIXTURE_03);
    expect(scan.feishu?.appId).toBe("cli_fixtureaaaaaaaa");
    expect(scan.feishu?.allowedUsers).toEqual(["ou_fixtureuser0001", "ou_fixtureuser0002"]);
    const channelSkips = scan.skips.filter((s) => s.area === "渠道").map((s) => s.item);
    expect(channelSkips).toContain("tg_bot_token");
    expect(channelSkips).toContain("tg_allowed_users");
  });

  it("记忆：L1/L2 原文读出；.md 进 SOP 候选；.py 与 L4 跳过", () => {
    const scan = scan03Source(FIXTURE_03);
    expect(scan.insightLines.length).toBeGreaterThan(0);
    expect(scan.factsContent).toContain("[ENV]");
    expect(scan.sopFiles.map((s) => s.name).sort()).toEqual(["penglai_compress_sop", "verify_sop"]);
    const memorySkips = scan.skips.filter((s) => s.area === "记忆").map((s) => s.item);
    expect(memorySkips).toContain("memory/keychain.py");
    expect(memorySkips).toContain("memory/L4_raw_sessions/");
  });
});

// ── 计划 ───────────────────────────────────────────────────────

describe("buildMigrationPlan: 对照 0.4 目标现状出决策", () => {
  it("全新目标：档案 create / 渠道 create / SOP 过审入树、未过归档", async () => {
    const plan = await planFixture();
    expect(plan.profiles.map((p) => p.action)).toEqual(["create", "create"]);
    expect(plan.profiles.find((p) => p.id === "ds-main")?.provider).toBe("deepseek");
    expect(plan.profiles.find((p) => p.id === "relay-gpt")?.provider).toBe("custom");
    expect(plan.channel.action).toBe("create");
    expect(plan.whitelist.map((w) => w.action)).toEqual(["create", "create"]);
    expect(plan.memory.insightAction).toBe("l1-section");
    expect(plan.memory.factsAction).toBe("archive");
    const compress = plan.memory.sops.find((s) => s.name === "penglai_compress_sop");
    const verify = plan.memory.sops.find((s) => s.name === "verify_sop");
    expect(compress?.action).toBe("plant");
    expect(compress?.audit.pass).toBe(true);
    expect(verify?.action).toBe("archive");
    expect(verify?.audit.pass).toBe(false);
    expect(verify?.archiveName).toBe("archive03-sop-verify_sop");
    expect(planHasWrites(plan)).toBe(true);
  });

  it("档案 id 冲突：已存在不同内容 → conflict-skip 不覆盖", async () => {
    // 预置一个同名不同配置的档案。
    const { savePersistedProfile } = await import("../src/profiles-store.js");
    savePersistedProfile(dataDir, {
      id: "ds-main",
      label: "owner 手配",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-reasoner",
      apiKeyEnv: "",
      apiKey: "sk-owner-other-key-000000000000",
    });
    const plan = await planFixture();
    const conflict = plan.profiles.find((p) => p.id === "ds-main");
    expect(conflict?.action).toBe("conflict-skip");
    expect(conflict?.reason).toContain("未覆盖");
    // relay-gpt 不受影响。
    expect(plan.profiles.find((p) => p.id === "relay-gpt")?.action).toBe("create");
  });

  it("L1 ≤30 行铁律：0.3 L1 过长 → 裁剪入 L1 + 全文归档", async () => {
    // 构造胖 L1 源：fixture 目录复制后扩写 insight 到 40 行。
    const fatDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-03-fat-"));
    fs.cpSync(FIXTURE_03, fatDir, { recursive: true });
    const fatInsight = Array.from({ length: 40 }, (_, i) => `L1 行 ${i + 1}: 某条高频索引`).join("\n");
    fs.writeFileSync(path.join(fatDir, "memory", "global_mem_insight.txt"), fatInsight);
    try {
      const scan = scan03Source(fatDir);
      const plan = await buildMigrationPlan(fatDir, scan, {
        dataDir,
        memory: memoryAt(dataDir),
        existingWhitelist: readExistingWhitelist(dataDir),
      });
      expect(plan.memory.insightAction).toBe("l1-section-truncated");
      applyMigration(plan, { clock: CLOCK });
      const l1Lines = fs
        .readFileSync(path.join(dataDir, "memory", "global", "L1.md"), "utf-8")
        .split("\n");
      expect(l1Lines.length).toBeLessThanOrEqual(30);
      const archive = memoryAt(dataDir).readGlobalNote("archive03-l1-insight");
      expect(archive).toContain("L1 行 40");
      expect(l1Lines.join("\n")).toContain("archive03-l1-insight");
    } finally {
      fs.rmSync(fatDir, { recursive: true, force: true });
    }
  });
});

// ── 执行 / 幂等 / 回滚 ─────────────────────────────────────────

describe("applyMigration: 备份 → 写入 → 报告", () => {
  it("dataDir 独占锁拒绝第二迁移，释放后不遗留 lock 目录", async () => {
    const plan = await planFixture();
    const held = acquireDataDirOperationLock(dataDir, "runtime");
    try {
      expect(() => applyMigration(plan, { clock: CLOCK })).toThrow(
        /dataDir operation is already active: runtime/,
      );
      expect(fs.existsSync(path.join(dataDir, "product.db"))).toBe(false);
      expect(fs.existsSync(path.join(dataDir, "migrate-backup"))).toBe(false);
    } finally {
      held.release();
    }
    expect(fs.existsSync(path.join(dataDir, ".penglai-operation-lock"))).toBe(false);
  });

  it("死 PID claim 可由新 owner 安全接管；release 不删除 nonce 已变化的 claim", () => {
    const abandoned = acquireDataDirOperationLock(dataDir, "migration-apply", {
      pid: 2_147_483_646,
      nonce: "a".repeat(32),
      processAlive: () => false,
    });
    const recovered = acquireDataDirOperationLock(dataDir, "migration-rollback");
    recovered.release();
    expect(fs.existsSync(abandoned.claimFile)).toBe(false);

    const owned = acquireDataDirOperationLock(dataDir, "migration-apply", {
      nonce: "b".repeat(32),
    });
    const tampered = JSON.parse(fs.readFileSync(owned.claimFile, "utf-8")) as {
      nonce: string;
    };
    tampered.nonce = "c".repeat(32);
    fs.writeFileSync(owned.claimFile, `${JSON.stringify(tampered)}\n`, { mode: 0o600 });
    expect(() => owned.release()).toThrow(/ownership changed; refusing to unlink/);
    expect(fs.existsSync(owned.claimFile)).toBe(true);
  });

  it("锁拒绝 symlink dataDir，且 release 不跟随被替换成 symlink 的 claim", () => {
    const realDataDir = path.join(dataDir, "real-data");
    const linkedDataDir = path.join(dataDir, "linked-data");
    fs.mkdirSync(realDataDir);
    fs.symlinkSync(realDataDir, linkedDataDir, "dir");
    expect(() => acquireDataDirOperationLock(linkedDataDir, "runtime")).toThrow(
      /dataDir is not a real directory/,
    );

    const owned = acquireDataDirOperationLock(realDataDir, "migration-apply");
    const sentinel = path.join(dataDir, "owner-sentinel.txt");
    fs.writeFileSync(sentinel, "owner data\n", { mode: 0o600 });
    fs.unlinkSync(owned.claimFile);
    fs.symlinkSync(sentinel, owned.claimFile);
    expect(() => owned.release()).toThrow(/ownership changed; refusing to unlink/);
    expect(fs.readFileSync(sentinel, "utf-8")).toBe("owner data\n");
    expect(fs.lstatSync(owned.claimFile).isSymbolicLink()).toBe(true);
  });

  it("首次执行：全部落盘（0600），报告掩码不含任何原始秘钥", async () => {
    const result = applyMigration(await planFixture(), { clock: CLOCK });
    expect(result.wrote).toBe(true);
    expect(result.backupDir).not.toBeNull();

    // 模型档案 0600 + 内容
    const profilesFile = path.join(dataDir, "profiles.json");
    expect(fs.statSync(profilesFile).mode & 0o777).toBe(0o600);
    const profiles = loadPersistedProfiles(dataDir);
    expect(profiles.map((p) => p.id).sort()).toEqual(["ds-main", "relay-gpt"]);
    expect(profiles.find((p) => p.id === "ds-main")).toMatchObject({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-fixture0000000000000000000000deadbeef",
    });

    // 渠道 0600 + 白名单
    expect(fs.statSync(path.join(dataDir, "channels.json")).mode & 0o777).toBe(0o600);
    expect(loadChannelConfig(dataDir)).toMatchObject({ appId: "cli_fixtureaaaaaaaa", enabled: true });
    expect([...readExistingWhitelist(dataDir)].sort()).toEqual(["ou_fixtureuser0001", "ou_fixtureuser0002"]);

    // 记忆：L1 迁移区 / 事实归档 / SOP 入树 / 审计未过归档
    const memory = memoryAt(dataDir);
    const l1 = fs.readFileSync(path.join(dataDir, "memory", "global", "L1.md"), "utf-8");
    expect(l1).toContain("penglai:migration-03:start");
    expect(l1).toContain("验证纪律→verify_sop");
    expect(memory.readGlobalNote("archive03-facts")).toContain("[ENV]");
    expect(memory.listSops().map((s) => s.name)).toEqual(["penglai_compress_sop"]);
    expect(memory.readGlobalNote("archive03-sop-verify_sop")).toContain("审计未过");

    // 报告掩码：任何原始秘钥/appSecret 都不得出现。
    const report = result.report;
    expect(report).toContain("sk-f…beef");
    expect(report).not.toContain("sk-fixture0000000000000000000000deadbeef");
    expect(report).not.toContain("sk-relayfixture1111111111111111cafe");
    expect(report).not.toContain("fixturesecret0000000000000000ffffffff");
    expect(report).toContain("备份与回滚");

    // 备份 manifest 齐备。
    const manifest = JSON.parse(
      fs.readFileSync(path.join(result.backupDir!, "manifest.json"), "utf-8"),
    ) as { filesCreated: string[]; whitelistAdded: string[] };
    expect(manifest.filesCreated.length).toBeGreaterThan(0);
    expect(manifest.whitelistAdded).toEqual(["ou_fixtureuser0001", "ou_fixtureuser0002"]);
    expect(fs.existsSync(path.join(result.backupDir!, "report.md"))).toBe(true);
  });

  it("全新 dataDir + whitelist 由 ProductStore 建完整 schema，首次 Host 打开成功", async () => {
    const plan = await planFixture();
    applyMigration(plan, { clock: CLOCK });
    const store = new ProductStore(path.join(dataDir, "product.db"));
    try {
      const version = Number(
        (store.database.prepare("PRAGMA user_version").get() as { user_version: number })
          .user_version,
      );
      expect(version).toBe(DATABASE_SCHEMA_VERSION);
      expect(store.listChannelIdentities("feishu").map((entry) => entry.channelUserId).sort()).toEqual(
        plan.whitelist
          .filter((entry) => entry.action === "create")
          .map((entry) => entry.openId)
          .sort(),
      );
    } finally {
      store.close();
    }
  });

  it("迁移模式只升级 schema，不把既有 running run 当 Host 重启失败化", async () => {
    const store = new ProductStore(path.join(dataDir, "product.db"));
    const project = store.createProject({ name: "owner", rootPath: dataDir, trusted: true });
    const task = store.createTask({ projectId: project.id, title: "live", objective: "stay live" });
    const run = store.createRun({ taskId: task.id, modelProfileId: "owner" });
    store.transitionRun(run.id, "running");
    store.close();

    applyMigration(await planFixture(), { clock: CLOCK });
    const database = new DatabaseSync(path.join(dataDir, "product.db"));
    try {
      const row = database.prepare("SELECT status FROM runs WHERE id = ?").get(run.id) as {
        status: string;
      };
      expect(row.status).toBe("running");
    } finally {
      database.close();
    }
  });

  it("VACUUM INTO before 快照包含未 checkpoint WAL，并可完整恢复 owner 行", async () => {
    seedRecoveryFixture(dataDir);
    const databasePath = path.join(dataDir, "product.db");
    const writer = new DatabaseSync(databasePath);
    writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
    writer
      .prepare(
        `INSERT INTO channel_identities
           (channel, channel_user_id, identity, note, created_at)
         VALUES ('feishu', ?, 'owner', 'committed only in WAL', ?)`,
      )
      .run("ou_owner_uncheckpointed_wal", CLOCK().getTime());
    const walPath = `${databasePath}-wal`;
    expect(fs.existsSync(walPath)).toBe(true);
    expect(fs.statSync(walPath).size).toBeGreaterThan(0);

    const before = captureDataState(dataDir);
    const result = applyMigration(await planFixture(), { clock: CLOCK });
    const journal = readMigrationJournal(result.backupDir!);
    expect(journal.sqliteSnapshots).toHaveLength(1);
    const snapshot = journal.sqliteSnapshots[0];
    expect(snapshot).toMatchObject({
      databasePath,
      databaseExisted: true,
    });
    const beforeDatabase = new DatabaseSync(path.join(result.backupDir!, snapshot.beforeFile!));
    try {
      expect(
        beforeDatabase
          .prepare(
            "SELECT 1 AS present FROM channel_identities WHERE channel_user_id = ?",
          )
          .get("ou_owner_uncheckpointed_wal"),
      ).toBeTruthy();
      expect(
        Object.values(
          beforeDatabase.prepare("PRAGMA quick_check").get() as Record<string, unknown>,
        )[0],
      ).toBe("ok");
    } finally {
      beforeDatabase.close();
      writer.close();
    }
    rollbackMigration(result.backupDir!, { clock: CLOCK });
    expect(captureDataState(dataDir)).toEqual(before);
    expect(readExistingWhitelist(dataDir)).toContain("ou_owner_uncheckpointed_wal");
  });

  it("迁移后 product.db 出现 owner 写入时 rollback 在任何目标变化前 fail closed", async () => {
    const result = applyMigration(await planFixture(), { clock: CLOCK });
    const store = new ProductStore(path.join(dataDir, "product.db"));
    const project = store.createProject({ name: "post-migrate", rootPath: dataDir, trusted: true });
    store.close();
    const profilesBefore = fs.readFileSync(path.join(dataDir, "profiles.json"));

    expect(() => rollbackMigration(result.backupDir!, { clock: CLOCK })).toThrow(
      /外部修改.*owner 数据/,
    );
    expect(fs.readFileSync(path.join(dataDir, "profiles.json"))).toEqual(profilesBefore);
    const reopened = new ProductStore(path.join(dataDir, "product.db"), {
      recoverInterruptedRuns: false,
    });
    try {
      expect(reopened.getProject(project.id)?.name).toBe("post-migrate");
    } finally {
      reopened.close();
    }
    expect(readMigrationJournal(result.backupDir!).state).toBe("committed");
  });

  it("迁移后普通文件被 owner 修改时 rollback 全局预检拒绝且不部分恢复", async () => {
    const result = applyMigration(await planFixture(), { clock: CLOCK });
    const profiles = path.join(dataDir, "profiles.json");
    const channels = path.join(dataDir, "channels.json");
    const channelsBefore = fs.readFileSync(channels);
    fs.appendFileSync(profiles, "\nowner-post-migration-change\n");

    expect(() => rollbackMigration(result.backupDir!, { clock: CLOCK })).toThrow(
      /外部修改.*owner 数据/,
    );
    expect(fs.readFileSync(profiles, "utf8")).toContain("owner-post-migration-change");
    expect(fs.readFileSync(channels)).toEqual(channelsBefore);
    expect(readMigrationJournal(result.backupDir!).state).toBe("committed");
  });

  it("幂等复跑：全部 skip-unchanged，零写入零新备份", async () => {
    applyMigration(await planFixture(), { clock: CLOCK });
    const backupsBefore = fs.readdirSync(path.join(dataDir, "migrate-backup"));
    const second = applyMigration(await planFixture(), { clock: () => new Date("2026-07-29T16:00:00") });
    expect(second.wrote).toBe(false);
    expect(second.backupDir).toBeNull();
    expect(second.report).toContain("幂等跳过");
    expect(fs.readdirSync(path.join(dataDir, "migrate-backup"))).toEqual(backupsBefore);
    // 第三次（无备份目录差异）依然幂等。
    const third = applyMigration(await planFixture(), { clock: CLOCK });
    expect(third.wrote).toBe(false);
  });

  it("dry-run：只出计划，数据目录零写入", async () => {
    const result = applyMigration(await planFixture(), { dryRun: true, clock: CLOCK });
    expect(result.wrote).toBe(false);
    expect(result.report).toContain("干跑");
    expect(result.report).not.toContain("sk-fixture0000000000000000000000deadbeef");
    expect(fs.existsSync(path.join(dataDir, "profiles.json"))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "migrate-backup"))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "memory"))).toBe(false);
  });

  it("回滚：新建删除、覆盖恢复、白名单移除、L1 复原", async () => {
    applyMigration(await planFixture(), { clock: CLOCK });
    const backup = latestBackupDir(dataDir)!;
    const lines = rollbackMigration(backup);
    expect(lines.some((l) => l.includes("恢复"))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "profiles.json"))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "channels.json"))).toBe(false);
    expect(memoryAt(dataDir).listSops()).toEqual([]);
    expect(readExistingWhitelist(dataDir).size).toBe(0);
    // 迁移前没有 memory/；回滚恢复到真正的前态，不遗留 seed 或空目录。
    expect(fs.existsSync(path.join(dataDir, "memory"))).toBe(false);
    expect(readMigrationJournal(backup).state).toBe("rolled_back");
    // 回滚幂等：再来一次不报错。
    const again = rollbackMigration(backup);
    expect(again.length).toBeGreaterThan(0);
  });

  const crashPoints = [
    "before:backups",
    "before:sqlite-snapshots",
    "after:sqlite-snapshots",
    "after:backups",
    "before:profiles",
    "after:profiles",
    "before:channel",
    "after:channel",
    "before:whitelist",
    "after:whitelist",
    "before:memory-l1",
    "after:memory-l1",
    "before:memory-archives",
    "after:memory-archives",
    "before:memory-sops",
    "after:memory-sops",
    "before:report",
    "after:report",
    "before:commit",
    "after:commit",
  ] as const;

  it.each(crashPoints)("崩溃恢复：%s 后显式 rollback 精确复原", async (crashPoint) => {
    const before = seedRecoveryFixture(dataDir);
    const plan = await planFixture();
    expect(() =>
      applyMigration(plan, {
        clock: CLOCK,
        faultInjection: (point) => {
          if (point === crashPoint) throw new Error(`simulated crash at ${point}`);
        },
      }),
    ).toThrow(`simulated crash at ${crashPoint}`);

    const backup = latestBackupDir(dataDir)!;
    expect(backup).not.toBeNull();
    expect(readMigrationJournal(backup).state).toBe(
      crashPoint === "after:commit" ? "committed" : "in_progress",
    );
    rollbackMigration(backup, { clock: CLOCK });
    expect(readMigrationJournal(backup).state).toBe("rolled_back");
    expect(captureDataState(dataDir)).toEqual(before);
  });

  it("write-ahead manifest 在首个目标写入前已完整、备份可校验", async () => {
    seedRecoveryFixture(dataDir);
    const plan = await planFixture();
    expect(() =>
      applyMigration(plan, {
        clock: CLOCK,
        faultInjection: (point) => {
          if (point === "before:profiles") throw new Error("stop before first target");
        },
      }),
    ).toThrow("stop before first target");
    const backup = latestBackupDir(dataDir)!;
    const manifest = JSON.parse(
      fs.readFileSync(path.join(backup, "manifest.json"), "utf-8"),
    ) as {
      state: string;
      phase: string;
      filesBackedUp: Array<{ backup: string; sha256: string }>;
      filesCreated: string[];
      whitelistRecovery: { tableExisted: boolean; intendedAdded: string[] };
    };
    expect(manifest).toMatchObject({ state: "in_progress", phase: "preparing_backups" });
    expect(manifest.filesBackedUp.length).toBeGreaterThan(0);
    expect(manifest.filesCreated.length).toBeGreaterThan(0);
    expect(manifest.whitelistRecovery).toMatchObject({
      tableExisted: true,
      intendedAdded: ["ou_fixtureuser0001", "ou_fixtureuser0002"],
    });
    for (const entry of manifest.filesBackedUp) {
      const backupFile = path.join(backup, entry.backup);
      expect(fs.existsSync(backupFile)).toBe(true);
      expect(crypto.createHash("sha256").update(fs.readFileSync(backupFile)).digest("hex")).toBe(
        entry.sha256,
      );
    }
    expect(readMigrationJournal(backup)).toMatchObject({
      state: "in_progress",
      phase: "apply:profiles:prepared",
      currentStep: "profiles",
    });
  });

  it("未完成 journal 禁止覆盖式重跑；回滚后可确定性重迁", async () => {
    const before = seedRecoveryFixture(dataDir);
    const initialPlan = await planFixture();
    expect(() =>
      applyMigration(initialPlan, {
        clock: CLOCK,
        faultInjection: (point) => {
          if (point === "after:profiles") throw new Error("simulated crash");
        },
      }),
    ).toThrow("simulated crash");
    const stalePlan = await planFixture();
    expect(() =>
      applyMigration(stalePlan, { clock: () => new Date("2026-07-29T15:31:00") }),
    ).toThrow(/未完成迁移.*禁止覆盖式重跑/);

    const interrupted = latestBackupDir(dataDir)!;
    rollbackMigration(interrupted, { clock: CLOCK });
    expect(captureDataState(dataDir)).toEqual(before);
    const rerun = applyMigration(await planFixture(), {
      clock: () => new Date("2026-07-29T15:31:00"),
    });
    expect(rerun.wrote).toBe(true);
    expect(readMigrationJournal(rerun.backupDir!).state).toBe("committed");
  });

  it("白名单多行插入在一个事务内：行间故障不留下半批数据", async () => {
    const before = seedRecoveryFixture(dataDir);
    const plan = await planFixture();
    expect(() =>
      applyMigration(plan, {
        clock: CLOCK,
        faultInjection: (point) => {
          if (point === "during:whitelist:1") throw new Error("sqlite row fault");
        },
      }),
    ).toThrow("sqlite row fault");
    expect([...readExistingWhitelist(dataDir)].sort()).toEqual(["ou_owner_existing"]);
    const backup = latestBackupDir(dataDir)!;
    rollbackMigration(backup, { clock: CLOCK });
    expect(captureDataState(dataDir)).toEqual(before);
  });

  it("rollback 自身中断后可重放并完成恢复", async () => {
    const before = seedRecoveryFixture(dataDir);
    const result = applyMigration(await planFixture(), { clock: CLOCK });
    expect(() =>
      rollbackMigration(result.backupDir!, {
        clock: CLOCK,
        faultInjection: (point) => {
          if (point === "after:rollback:delete-created:0001") {
            throw new Error("rollback crash");
          }
        },
      }),
    ).toThrow("rollback crash");
    expect(readMigrationJournal(result.backupDir!).state).toBe("in_progress");
    rollbackMigration(result.backupDir!, { clock: CLOCK });
    expect(readMigrationJournal(result.backupDir!).state).toBe("rolled_back");
    expect(captureDataState(dataDir)).toEqual(before);
  });

  it.each([
    "during:rollback:sqlite:checkpointed",
    "during:rollback:sqlite:sidecars-removed",
    "during:rollback:sqlite:restored",
  ])("SQLite 回滚内部故障 %s 可重放到精确前态", async (faultPoint) => {
    const before = seedRecoveryFixture(dataDir);
    const result = applyMigration(await planFixture(), { clock: CLOCK });
    expect(() =>
      rollbackMigration(result.backupDir!, {
        clock: CLOCK,
        faultInjection: (point) => {
          if (point === faultPoint) throw new Error(`simulated crash at ${point}`);
        },
      }),
    ).toThrow(`simulated crash at ${faultPoint}`);
    expect(readMigrationJournal(result.backupDir!).state).toBe("in_progress");
    rollbackMigration(result.backupDir!, { clock: CLOCK });
    expect(readMigrationJournal(result.backupDir!).state).toBe("rolled_back");
    expect(captureDataState(dataDir)).toEqual(before);
  });

  it("备份缺失时回滚在首个目标变更前 fail closed", async () => {
    seedRecoveryFixture(dataDir);
    const result = applyMigration(await planFixture(), { clock: CLOCK });
    const journal = readMigrationJournal(result.backupDir!);
    const backupFile = path.join(result.backupDir!, journal.filesBackedUp[0].backup);
    fs.rmSync(backupFile);
    const migrated = captureDataState(dataDir);
    expect(() => rollbackMigration(result.backupDir!, { clock: CLOCK })).toThrow(
      /备份副本缺失，拒绝部分回滚/,
    );
    expect(captureDataState(dataDir)).toEqual(migrated);
    expect(readMigrationJournal(result.backupDir!).state).toBe("committed");
  });

  it("旧版 manifest 缺少 postimage 时拒绝破坏性自动回滚", () => {
    const target = path.join(dataDir, "profiles.json");
    const original = "owner profiles before legacy migration\n";
    fs.writeFileSync(target, "legacy migration output\n", { mode: 0o600 });
    const backup = path.join(dataDir, "migrate-backup", "20260729-120000");
    fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(path.join(backup, "profiles.json"), original, { mode: 0o600 });
    fs.writeFileSync(
      path.join(backup, "manifest.json"),
      `${JSON.stringify({
        createdAt: "2026-07-29T12:00:00.000Z",
        dataDir,
        sourceDir: FIXTURE_03,
        filesBackedUp: [{ path: target, backup: "profiles.json" }],
        filesCreated: [],
        whitelistAdded: [],
      }, null, 2)}\n`,
      { mode: 0o600 },
    );

    expect(() => rollbackMigration(backup, { clock: CLOCK })).toThrow(
      /缺少 post-apply 指纹/,
    );
    expect(readMigrationJournal(backup)).toMatchObject({
      state: "committed",
      legacyManifest: true,
    });
    expect(fs.readFileSync(target, "utf-8")).toBe("legacy migration output\n");
    expect(fs.readFileSync(path.join(backup, "profiles.json"), "utf-8")).toBe(original);
  });
});

// ── CLI 命令面 ─────────────────────────────────────────────────

describe("penglai migrate 命令面", () => {
  function args(positionals: string[] = [], flags: Record<string, string | true> = {}) {
    return { positionals, flags };
  }

  it("--dry-run：计划全展示，零写入", async () => {
    vi.stubEnv("PENGLAI_DATA_DIR", dataDir);
    const cap = captureIo(false);
    const code = await cmdMigrate(cap.io, args([], { from: FIXTURE_03, "dry-run": true }), {});
    expect(code).toBe(0);
    const out = cap.text();
    expect(out).toContain("迁移报告");
    expect(out).toContain("干跑");
    expect(out).toContain("sk-f…beef");
    expect(out).not.toContain("sk-fixture0000000000000000000000deadbeef");
    expect(fs.existsSync(path.join(dataDir, "profiles.json"))).toBe(false);
  });

  it("非 tty（prompter=null）：展示计划后给 --yes 指引，不写入", async () => {
    vi.stubEnv("PENGLAI_DATA_DIR", dataDir);
    const cap = captureIo(false);
    const code = await cmdMigrate(cap.io, args([], { from: FIXTURE_03 }), { prompter: null });
    expect(code).toBe(0);
    expect(cap.text()).toContain("--yes");
    expect(fs.existsSync(path.join(dataDir, "profiles.json"))).toBe(false);
  });

  it("交互确认：答 n 取消，答 y 执行", async () => {
    vi.stubEnv("PENGLAI_DATA_DIR", dataDir);
    const no = captureIo(true);
    const cancelCode = await cmdMigrate(no.io, args([], { from: FIXTURE_03 }), {
      prompter: { ask: () => Promise.resolve("n"), askSecret: () => Promise.reject() },
    });
    expect(cancelCode).toBe(0);
    expect(no.text()).toContain("已取消");
    expect(fs.existsSync(path.join(dataDir, "profiles.json"))).toBe(false);

    const yes = captureIo(true);
    const okCode = await cmdMigrate(yes.io, args([], { from: FIXTURE_03 }), {
      prompter: { ask: () => Promise.resolve("y"), askSecret: () => Promise.reject() },
      clock: CLOCK,
    });
    expect(okCode).toBe(0);
    expect(yes.text()).toContain("模式：执行");
    expect(fs.existsSync(path.join(dataDir, "profiles.json"))).toBe(true);
  });

  it("--yes：免确认直接执行；rollback 子命令回滚", async () => {
    vi.stubEnv("PENGLAI_DATA_DIR", dataDir);
    const run = captureIo(false);
    expect(await cmdMigrate(run.io, args([], { from: FIXTURE_03, yes: true }), { clock: CLOCK })).toBe(0);
    expect(fs.existsSync(path.join(dataDir, "profiles.json"))).toBe(true);

    const back = captureIo(false);
    expect(await cmdMigrate(back.io, args(["rollback"]), {})).toBe(0);
    expect(back.text()).toContain("回滚完成");
    expect(fs.existsSync(path.join(dataDir, "profiles.json"))).toBe(false);
  });

  it("--from 指向非 0.3 目录：报错引导", async () => {
    vi.stubEnv("PENGLAI_DATA_DIR", dataDir);
    const cap = captureIo(false);
    const code = await cmdMigrate(cap.io, args([], { from: dataDir }), {});
    expect(code).toBe(2);
    expect(cap.text()).toContain("mykey.py");
  });
});
