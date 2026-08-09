#!/usr/bin/env node
/**
 * sync-catalog.mjs — 从 penglai_providers.yaml 生成 TS 供应商目录数据源。
 *
 * 三层新鲜度机制（owner：「数据会过期，机制不会；目录不要复制粘贴」）：
 *
 *   L1 yaml 种子（本脚本处理的一层）：penglai_providers.yaml →
 *      catalog.generated.ts。角色是**兜底**——永可用、永可离线展示，
 *      但不要求永远最新；更新方式 = 改 yaml 后重跑本脚本。
 *   L2 实时拉取：向导选模型时 `GET {base_url}/models`（providers/models.ts），
 *      成功则实时优先合并，失败分类降级回种子层。
 *   L3 refresh 覆盖层：`penglai catalog refresh`（providers/refresh.ts +
 *      overlay.ts）对有 key 的档案实拉 /models，把「实时模型列表 +
 *      校准时间」持久化到 <data-dir>/catalog-overlay.json；向导与
 *      `penglai catalog status` 据此显示「已知模型 N 个 · 校准于 <时间>」，
 *      实时探测不可用时用校准缓存兜底。yaml 种子永远是最后的兜底。
 *
 * 源文件（单一事实来源，与 0.3 生产仓库保持逐字节一致）：
 *   本仓库根目录 ./penglai_providers.yaml
 *   （镜像自 0.3 生产仓库的同名文件，2026-06-29 实测修正版；
 *     0.3 仓库为只读参考，绝不修改）
 *
 * 产物：packages/host/src/providers/catalog.generated.ts（请勿手改）。
 *
 * 用法：
 *   node scripts/sync-catalog.mjs           # 重新生成
 *   node scripts/sync-catalog.mjs --check   # 只校验产物是否最新（CI/测试用）
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "penglai_providers.yaml");
const TARGET = path.join(ROOT, "packages/host/src/providers/catalog.generated.ts");

const HEADER = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * 由 scripts/sync-catalog.mjs 从仓库根目录 penglai_providers.yaml 生成
 * （该 yaml 镜像自 0.3 生产仓库 penglai_providers.yaml，2026-06-29 实测修正版）。
 * 这是三层新鲜度机制的 L1 种子层（兜底）：L2 = 向导实时拉取 /models，
 * L3 = penglai catalog refresh 覆盖层（providers/overlay.ts）。
 * 重新生成：node scripts/sync-catalog.mjs
 */
`;

function render(doc) {
  const json = JSON.stringify(doc, null, 2);
  return (
    HEADER +
    `\nexport const PROVIDER_CATALOG = ${json} as const;\n\n` +
    `export const PROVIDER_CATALOG_SOURCE = "penglai_providers.yaml";\n`
  );
}

function main() {
  const check = process.argv.includes("--check");
  const raw = fs.readFileSync(SOURCE, "utf-8");
  const doc = YAML.parse(raw);
  if (!doc || typeof doc !== "object" || !doc.providers || !doc.wizard_order) {
    console.error(`sync-catalog: ${SOURCE} 缺少 providers/wizard_order，源文件损坏？`);
    process.exit(1);
  }
  const next = render(doc);
  if (check) {
    const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, "utf-8") : "";
    if (current !== next) {
      console.error("sync-catalog: catalog.generated.ts 与 yaml 不同步——请运行 node scripts/sync-catalog.mjs");
      process.exit(1);
    }
    console.log("sync-catalog: 产物与 yaml 同步 ✓");
    return;
  }
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, next);
  const providers = Object.keys(doc.providers).length;
  console.log(`sync-catalog: ${path.relative(ROOT, SOURCE)} → ${path.relative(ROOT, TARGET)}（updated ${doc.updated}，${providers} 家供应商）`);
}

main();
