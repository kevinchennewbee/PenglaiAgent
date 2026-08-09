/**
 * shots/feishu_card_data.mts — 用产品真实卡片构建函数生成审批卡片 JSON。
 *
 * 在产品仓库根目录运行：
 *   cd <PenglaiAgent>
 *   node --import tsx <site-repo>/shots/feishu_card_data.mts > <site-repo>/shots/feishu-card.js
 *
 * 输出是 `window.PENGLAI_CARD = {...}`，供 feishu-card.html 渲染。
 * 卡片结构 100% 来自 packages/host/src/feishu/protocol.ts 的
 * buildApprovalCard（legacy interactive card JSON）；仅示例数据为演示内容。
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";

const PRODUCT_REPO = process.env.PENGLAI_REPO ?? process.cwd();

const { buildApprovalCard } = await import(
  pathToFileURL(path.join(PRODUCT_REPO, "packages/host/src/feishu/protocol.ts")).href
);

const card = buildApprovalCard({
  approvalId: "b3f1c9a2-7e24-4d8b-9c51-2f6a0e8d41c7",
  level: "L3",
  capability: "l3:outbound",
  action: "bash: git push origin main",
  reason:
    "任务「重写官网 Hero 区块」已在 jail 内完成并本地验证通过；推送会改变外部状态、不可回退——按审批四级制，这一步必须你点头，决定全程留痕可回放。",
  taskTitle: "重写官网 Hero 区块",
});

console.log(`window.PENGLAI_CARD = ${JSON.stringify(card, null, 2)};`);
