/**
 * shots/serve_workbench.mts — 官网截图用：真实 Host + MockModel + 沙盒种子数据。
 *
 * 在产品仓库根目录下运行（tsx 解析产品内 TS 源码）：
 *   cd <PenglaiAgent>
 *   PENGLAI_DATA_DIR=/tmp/penglai-shot-workbench/data \
 *     node --import tsx <site-repo>/shots/serve_workbench.mts
 *
 * 行为：
 *   1. 起 MockModelServer（脚本化模型端点，无网络、无 key）；
 *   2. 起真实 Host（packages/host/src/server.ts）监听 127.0.0.1:14169，
 *      token 按生产逻辑写入 $PENGLAI_DATA_DIR/host.token；
 *   3. 通过生产 JSON-RPC 造种子数据：一段浮动对话、一次 Owner 项目锚定、
 *      一个真实完工的项目任务（jail 内真实写
 *      文件，产生真实证据轨与 checkpoint）、释放锚点后引用产物；
 *   4. 保持进程存活，供 vite dev（:1420）与 headless Chrome 截图。
 *
 * 除模型端点外全部是生产代码路径；沙盒目录在 /tmp，不碰真实 ~/.penglai。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const PRODUCT_REPO = process.env.PENGLAI_REPO ?? process.cwd();
const BASE = process.env.PENGLAI_SHOT_BASE ?? "/tmp/penglai-shot-workbench";
// 默认避开 14169（本机真实 penglai serve 可能正在使用）。
const PORT = Number(process.env.PENGLAI_SHOT_PORT ?? 14173);

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
const projectDir = path.join(BASE, "penglai-site");
fs.rmSync(BASE, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(projectDir, { recursive: true });

// 让项目看起来像真实工作区：两个已有文件。
fs.writeFileSync(
  path.join(projectDir, "hero.md"),
  "# 蓬莱\n\n住在你飞书里、完全属于你、越用越懂你的个人 AI 助理。\n",
);
fs.writeFileSync(path.join(projectDir, "README.md"), "# penglai-site\n\n官网静态站。\n");

const mock = new MockModelServer();
await mock.start();
_setPenglaiHomeForTest(home);

const server = await startServer({
  port: PORT,
  host: "127.0.0.1",
  dataDir,
  databasePath: path.join(dataDir, "product.db"),
  log: () => undefined,
});
const token: string = server.token;

const rpc = async <T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Penglai-Token": token },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
};

// ── 种子数据（全部走生产 RPC）────────────────────────────────
const PROFILE = "demo";
await rpc("config.createProfile", {
  id: PROFILE,
  baseUrl: mock.baseUrl,
  model: "mock-model",
  apiKey: "demo-key",
});
const ws = await rpc("workspace.open", { rootPath: projectDir, name: "蓬莱官网" });
const conversation = await rpc("conversation.create", {
  workspaceId: ws.id,
  modelProfileId: PROFILE,
  title: "官网首页文案打磨",
});

// 1) 浮动会话日常问答
const q1 = "在吗？帮我看看官网首页 Hero 的文案";
mock.register(q1, [
  {
    text: "在的。我读了一下 hero.md：主线是「住在你飞书里、完全属于你、越用越懂你」，挺好的。副标题如果想再收一收，我可以提议把当前对话锚定到这个项目后直接改。",
    usage: { input: 34, output: 20 },
  },
  {
    toolCalls: [
      {
        name: "write",
        arguments: {
          path: "hero.md",
          content:
            "# 蓬莱\n\n住在你飞书里、完全属于你、越用越懂你的个人 AI 助理。\n\n一个核心，同一条执行路径。\n",
        },
      },
    ],
    usage: { input: 28, output: 16 },
  },
  { text: "写好了：hero.md 已更新，副标题收进第三行。", usage: { input: 6, output: 3 } },
]);
await rpc("conversation.prompt", { conversationId: conversation.id, text: q1 });

// 2) Owner 在同一对话面选择项目，Host 把会话锚定到真实目录边界。
const anchored = await rpc("mode.proposeWork", {
  conversationId: conversation.id,
  rootPath: projectDir,
  objective: "把副标题改成「一个核心，同一条执行路径」写进 hero.md",
  title: "更新 Hero 副标题",
  sourceChannel: "desktop",
});

// 3) owner trust → 项目锚定后真实完工
await rpc("task.start", {
  taskId: anchored.task.id,
  modelProfileId: PROFILE,
  source: "desktop",
  conversationId: conversation.id,
});
// 等待 run 完工；期间出现 L2 审批（覆盖既有文件）由 owner 显式批准——
// 这正是产品要的姿态：审批四级制真实走一遍，留痕可回放。
for (let i = 0; i < 400; i += 1) {
  const pendings = await rpc("approval.list", { status: "pending" });
  const list = Array.isArray(pendings) ? pendings : (pendings.approvals ?? []);
  for (const a of list) {
    await rpc("approval.approve", {
      approvalId: a.id,
      decidedBy: "owner",
      note: "确认：副标题写进 hero.md",
    });
  }
  const bundle = await rpc("task.get", { taskId: anchored.task.id });
  const latest = bundle.runs.at(-1);
  if (latest && latest.status !== "running" && latest.status !== "waiting_approval") break;
  await new Promise((resolve) => setTimeout(resolve, 50));
}

// 4) 第二条轻量对话，让侧栏「最近对话」更真实
const smalltalk = await rpc("conversation.create", {
  workspaceId: ws.id,
  modelProfileId: PROFILE,
  title: "随手问：0.4 为什么重写",
});
const q4 = "0.4 为什么从 Python 重写成 TypeScript？";
mock.register(q4, [
  {
    text: "一句话：0.3 验证了叙事，0.4 把单一执行核心、项目边界和审批留痕做成内核级能力。TS 重写换来强类型协议、Pi 开源内核和更薄的客户端——细节你随时问。",
    usage: { input: 22, output: 18 },
  },
]);
await rpc("conversation.prompt", { conversationId: smalltalk.id, text: q4 });

console.log(`[shots] host ready  http://127.0.0.1:${PORT}  data=${dataDir}`);
console.log(`[shots] seeded conversation=${conversation.id} task=${anchored.task.id}`);

// 保持存活
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
setInterval(() => undefined, 1 << 30);
