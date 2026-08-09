/**
 * `penglai migrate` — 0.3 → 0.4 数据迁移（离线工具，不依赖 host 运行）。
 *
 * 命令面：
 *   penglai migrate [--from <0.3目录>] [--dry-run] [--yes]
 *   penglai migrate rollback [--backup <目录>]
 *
 * 默认探测 0.3 源目录（--from > PENGLAI_03_DIR > ~/.penglai、~/PenglaiAgent
 * 等常见路径）；交互终端展示计划（掩码版报告）后需确认（--yes 跳过确认）；
 * 非 tty 无 --yes 时只打印计划 + 指引，绝不挂起。写入前先备份到
 * <数据目录>/migrate-backup/<时间戳>/，rollback 按 manifest 回滚。
 */

import * as path from "node:path";
import { penglaiDataDir } from "../data-dir.js";
import { MemoryStore } from "../memory.js";
import type { CliIO, ParsedArgs } from "./format.js";
import { createReadlinePrompter, type WizardPrompter } from "./setup-wizard.js";
import {
  buildMigrationPlan,
  detect03SourceDir,
  planHasWrites,
  scan03Source,
  type MigrationPlan,
} from "../migrate/plan.js";
import {
  applyMigration,
  latestBackupDir,
  readExistingWhitelist,
  rollbackMigration,
} from "../migrate/apply.js";

export interface MigrateCmdDeps {
  /** 交互确认 seam（生产 readline；测试脚本化；非 tty 传 null）。 */
  prompter?: WizardPrompter | null;
  /** 确定性时钟（测试）。 */
  clock?: () => Date;
}

/** 计划摘要（确认前给 owner 看的压缩版；完整计划在报告里）。 */
function planDigest(plan: MigrationPlan): string[] {
  const creates = plan.profiles.filter((p) => p.action === "create").length;
  const sops = plan.memory.sops.filter((s) => s.action === "plant").length;
  const archived = plan.memory.sops.filter((s) => s.action === "archive").length;
  const whitelist = plan.whitelist.filter((w) => w.action === "create").length;
  const lines = [
    `  将执行：模型档案 ${creates} 个 · SOP 入树 ${sops} 条（归档 ${archived} 条）· 白名单 ${whitelist} 行` +
      `${plan.channel.action === "create" ? " · 飞书渠道配置" : ""}`,
  ];
  if (
    plan.memory.insightAction.startsWith("l1-section") ||
    plan.memory.insightAction === "archive-only"
  ) {
    lines.push("  记忆：0.3 L1 索引入 L1 迁移区（铁律内）＋ 事实库归档");
  }
  return lines;
}

export async function cmdMigrate(
  io: CliIO,
  args: ParsedArgs,
  deps: MigrateCmdDeps = {},
): Promise<number> {
  const dataDir = penglaiDataDir();
  const clock = deps.clock ?? (() => new Date());

  // ── rollback ──
  if (args.positionals[0] === "rollback") {
    const backupFlag = args.flags.backup;
    const backupDir =
      typeof backupFlag === "string" && backupFlag
        ? path.resolve(backupFlag)
        : latestBackupDir(dataDir);
    if (!backupDir) {
      io.err(`没有找到迁移备份（${path.join(dataDir, "migrate-backup")} 为空）——未曾执行过有写入的迁移。`);
      return 1;
    }
    try {
      io.line(`回滚迁移备份：${backupDir}`);
      for (const line of rollbackMigration(backupDir)) io.line(line);
      io.line("回滚完成。（备份目录保留，确认无误后可手工删除）");
      return 0;
    } catch (error) {
      io.err(`回滚失败：${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  // ── 探测源 ──
  const fromFlag = args.flags.from;
  let source;
  try {
    source = detect03SourceDir(typeof fromFlag === "string" && fromFlag ? fromFlag : undefined);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (!source) {
    io.err(
      "未找到 0.3 数据目录（判据：目录内有 mykey.py）。\n" +
        "请用 `penglai migrate --from <0.3目录>` 指定，或 export PENGLAI_03_DIR=<0.3目录>。",
    );
    return 1;
  }
  io.line(`0.3 源目录：${source.dir}（${source.how}）`);

  // ── 扫描 + 计划（SOP 过审计） ──
  const scan = scan03Source(source.dir);
  const plan = await buildMigrationPlan(source.dir, scan, {
    dataDir,
    memory: new MemoryStore(path.join(dataDir, "memory", "global")),
    existingWhitelist: readExistingWhitelist(dataDir),
  });

  const dryRun = args.flags["dry-run"] === true;
  const yes = args.flags.yes === true;

  // 干跑 / 预览报告（掩码版）。
  if (dryRun) {
    io.line(applyMigration(plan, { dryRun: true, clock }).report);
    return 0;
  }

  // 交互确认 prompter：显式注入（测试）> tty readline（生产）> null（非 tty 降级）。
  const ownsPrompter = deps.prompter === undefined && io.tty;
  const prompter =
    deps.prompter !== undefined
      ? deps.prompter
      : io.tty
        ? createReadlinePrompter()
        : null;
  try {
    // 非 tty 无 --yes：只展示计划 + 指引，绝不挂起。
    if (!yes && !prompter) {
      io.line(applyMigration(plan, { dryRun: true, clock }).report);
      io.line("");
      io.line("（非交互环境未执行：审阅以上计划后，用 `penglai migrate --yes` 执行。）");
      return 0;
    }

    // 交互确认。
    if (!yes && prompter) {
      io.line(applyMigration(plan, { dryRun: true, clock }).report);
      io.line("");
      for (const line of planDigest(plan)) io.line(line);
      const answer = (await prompter.ask("  › 执行迁移？[y/N]: ")).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        io.line("  已取消，未写入任何内容。");
        return 0;
      }
    }

    if (!planHasWrites(plan)) {
      io.line(applyMigration(plan, { clock }).report);
      return 0;
    }

    const result = applyMigration(plan, { clock });
    io.line(result.report);
    return 0;
  } finally {
    if (ownsPrompter) (prompter as { close?: () => void })?.close?.();
  }
}
