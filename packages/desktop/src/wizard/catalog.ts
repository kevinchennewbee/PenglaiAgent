/**
 * 桌面向导的目录数据面 —— 直接打包 host 的供应商目录（同源同文件）。
 *
 * 选型说明（任务要求二选一）：目录是纯静态引用数据（生成的 2026-06-29
 * 实测修正版），CLI 与桌面读同一个 catalog.generated.ts——打包进桌面而
 * 不新增 host catalog RPC，理由：
 *   1. 零 RPC 往返：向导在 Host 握手完成的第一帧即可渲染，无加载态；
 *   2. 两端永不漂移：同一份 TS 数据源，目录更新只改一处（sync-catalog）；
 *   3. 状态机可完全同步纯函数化（test/wizard-machine.test.ts 直接驱动）。
 * 实时性仍由既有 RPC 保证：config.listModels（L2 实时拉取）+
 * catalog.status（L3 校准覆盖层），与本模块的 L1 种子正好构成三层新鲜度。
 *
 * 本模块只 re-export 纯函数/纯数据模块（catalog / models / overlay-view /
 * model-smoke 类型）——host 侧任何带 node:fs 的模块（overlay.ts 持久化面
 * 等）绝不进桌面 bundle。
 */

export {
  CATALOG,
  billingIds,
  billingShortTag,
  catalogUpdated,
  checkDeprecated,
  defaultModelOf,
  describeModelContext,
  describeModelPrice,
  getBilling,
  getProvider,
  modelById,
  modelsOf,
  orderedProviders,
  type BillingMode,
  type CatalogModel,
  type ProviderCatalogDoc,
  type ProviderEntry,
} from "../../../host/src/providers/catalog.js";

export {
  mergeModels,
  type ListModelsResult,
  type MergedModel,
} from "../../../host/src/providers/models.js";

export {
  calibrationLine,
  overlayEntryFor,
  type CatalogOverlayEntry,
} from "../../../host/src/providers/overlay-view.js";

export type { SmokeResult } from "../../../host/src/model-smoke.js";

export {
  DEFAULT_ASSISTANT_NAME,
  introLines,
  sanitizeAssistantName,
} from "../../../host/src/onboarding/intro.js";
