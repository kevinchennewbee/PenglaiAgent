/**
 * 目录校准覆盖层（Catalog Overlay）— 三层新鲜度机制的第三层（持久化面）。
 *
 * 三层机制（数据会过期，机制不会；docs/ABSORPTION_0.3.md）：
 *   L1 yaml 种子：penglai_providers.yaml → catalog.generated.ts（兜底，永可用）；
 *   L2 实时拉取：向导选模型时 GET /models（超越 0.3.x 的在线新鲜度）；
 *   L3 校准覆盖层（本文件）：`penglai catalog refresh` 对有 key 的档案实拉
 *   /models 后落盘 <data-dir>/catalog-overlay.json——模型列表与校准时间从此
 *   可持久、可离线展示（「已知模型 N 个 · 校准于 <时间>」），yaml 种子永为兜底。
 *
 * 覆盖层只存「事实观测」（baseUrl + 实时模型 id + 校准时间），价格/特性等
 * 目录字段仍由种子层提供；无 key 的供应商不进覆盖层（CLI 提示「配置后可校准」）。
 *
 * 纯查询/文案面（CatalogOverlayEntry / overlayEntryFor / withOverlayModels /
 * calibrationLine）在 overlay-view.ts——无 fs，桌面端向导可直接打包复用；
 * 本文件 re-export 保持既有 import 路径不变。
 */

import * as path from "node:path";
import { atomicWritePrivateJson, readPrivateTextFile } from "../security/private-file.js";
import {
  type CatalogOverlayEntry,
} from "./overlay-view.js";

export {
  type CatalogOverlayEntry,
  overlayEntryFor,
  withOverlayModels,
  calibrationLine,
} from "./overlay-view.js";

interface CatalogOverlayFile {
  schemaVersion: 1;
  entries: CatalogOverlayEntry[];
}

// ── 持久化（tmp+rename 原子写；无密钥，0600 与 profiles 同章法） ──

export function catalogOverlayPath(dataDir: string): string {
  return path.join(dataDir, "catalog-overlay.json");
}

function isValidEntry(entry: unknown): entry is CatalogOverlayEntry {
  const e = entry as CatalogOverlayEntry;
  return (
    !!e &&
    typeof e === "object" &&
    typeof e.providerId === "string" &&
    e.providerId.length > 0 &&
    typeof e.billingId === "string" &&
    e.billingId.length > 0 &&
    typeof e.baseUrl === "string" &&
    Array.isArray(e.modelIds) &&
    e.modelIds.every((id) => typeof id === "string" && id.length > 0) &&
    typeof e.checkedAt === "number" &&
    e.checkedAt > 0
  );
}

/** 读覆盖层；缺失/损坏一律容错为空。 */
export function loadCatalogOverlay(dataDir: string): CatalogOverlayEntry[] {
  let parsed: CatalogOverlayFile;
  try {
    parsed = JSON.parse(
      readPrivateTextFile(catalogOverlayPath(dataDir), 2 * 1024 * 1024, true).text,
    ) as CatalogOverlayFile;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.entries)) return [];
  return parsed.entries.filter(isValidEntry);
}

/** Upsert 一条校准记录并原子重写文件。返回文件路径。 */
export function saveCatalogOverlayEntry(
  dataDir: string,
  entry: CatalogOverlayEntry,
): string {
  const entries = loadCatalogOverlay(dataDir).filter(
    (e) => !(e.providerId === entry.providerId && e.billingId === entry.billingId),
  );
  entries.push(entry);
  const file = catalogOverlayPath(dataDir);
  const payload: CatalogOverlayFile = { schemaVersion: 1, entries };
  atomicWritePrivateJson(file, payload, 2 * 1024 * 1024);
  return file;
}
