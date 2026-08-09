/**
 * shots/serve_wizard.mts — 官网截图用：桌面首次启动向导的真实后端。
 *
 * 在产品仓库根目录下运行（tsx 解析产品内 TS 源码）：
 *   cd <PenglaiAgent-040-rebuild>
 *   PENGLAI_DATA_DIR=/tmp/penglai-shot-wizard/data \
 *     node --import tsx <site-repo>/shots/serve_wizard.mts
 *
 * 与 serve_workbench.mts 的差别：沙盒数据目录**没有任何 key 可解析的
 * 模型档案**（屏蔽内置目录档案的环境变量）——桌面连接 Host 后自动进入
 * 首次启动向导（这正是要截的产品行为，与 CLI 裸跑 `penglai` 同判据）。
 *
 * 行为：
 *   1. 起 MockModelServer 并注册 GET /models 应答列表（自定义端点路径的
 *      实时模型列表 + 冒烟验证都由它真实应答；零网络、无 key）；
 *   2. 起真实 Host（packages/host/src/server.ts）监听 127.0.0.1:14174，
 *      token 按生产逻辑写入 $PENGLAI_DATA_DIR/host.token；
 *   3. 打印 mock 端点 URL（截图驱动脚本要把这个 URL 填进自定义端点页）；
 *   4. 保持进程存活，供 dev_proxy.mjs 与 headless Chrome 截图。
 *
 * 除模型端点外全部是生产代码路径（向导 UI → config.listModels /
 * config.smokeTest / config.createProfile / onboarding.* RPC）；
 * 沙盒目录在 /tmp，不碰真实 ~/.penglai。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const PRODUCT_REPO =
  process.env.PENGLAI_REPO ?? path.resolve(process.cwd());
const BASE = process.env.PENGLAI_SHOT_BASE ?? "/tmp/penglai-shot-wizard";
// 默认避开 14169（本机真实 penglai serve）与 14173（workbench 截图实例）。
const PORT = Number(process.env.PENGLAI_SHOT_PORT ?? 14174);

const { startServer } = await import(
  pathToFileURL(path.join(PRODUCT_REPO, "packages/host/src/server.ts")).href
);
const { MockModelServer } = await import(
  pathToFileURL(path.join(PRODUCT_REPO, "packages/host/src/demo/mock-model-server.ts")).href
);
const { _setPenglaiHomeForTest } = await import(
  pathToFileURL(path.join(PRODUCT_REPO, "packages/host/src/conversation-store.ts")).href
);

const dataDir = process.env.PENGLAI_DATA_DIR ?? path.join(BASE, "data");
const home = path.join(BASE, "home");
fs.rmSync(BASE, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(home, { recursive: true });

const mock = new MockModelServer();
await mock.start();
// 自定义端点页的实时模型列表（config.listModels 的真实应答）。
mock.registerModelIds([
  "penglai-local-7b-chat",
  "qwen3-32b-ctx32k",
  "deepseek-r1-distill-14b",
]);
_setPenglaiHomeForTest(home);

// 关键：不创建任何模型档案，且屏蔽内置目录档案的环境变量——这样
// config.resolveProfile 无 key 可解析，桌面连上后自动进入首次启动向导
// （CLI 裸跑 `penglai` 同判据；本机真实 shell 恰好有这些变量时亦确定复现）。
for (const name of ["GROK_API_KEY", "DEEPSEEK_API_KEY", "ZAI_API_KEY", "OPENAI_API_KEY"]) {
  delete process.env[name];
}
const server = await startServer({
  port: PORT,
  host: "127.0.0.1",
  dataDir,
  databasePath: path.join(dataDir, "product.db"),
  log: () => undefined,
});

console.log(`[shots] wizard host ready  http://127.0.0.1:${PORT}  data=${dataDir}`);
console.log(`[shots] mock model endpoint (填进自定义端点页): ${mock.baseUrl}`);
console.log(`[shots] no key-ready profile → 桌面将自动进入首次启动向导`);

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
setInterval(() => undefined, 1 << 30);
