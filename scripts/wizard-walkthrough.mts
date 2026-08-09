// 新向导渲染走查（非产品路径）：脚本化 prompter + 非 tty 顺序输出。
import { runSetupWizard } from "../packages/host/src/cli/setup-wizard.js";
import { createPager } from "../packages/host/src/cli/pager.js";

const asks = ["", "2", "1", "", ""];       // 欢迎回车 / 火山 / 按量 / 默认模型
const secrets = ["sk-demo-key"];
const io = {
  out: (t) => process.stdout.write(t),
  line: (t) => process.stdout.write(t + "\n"),
  err: (t) => process.stderr.write(t + "\n"),
  tty: false,
};
const result = await runSetupWizard({
  io,
  pager: createPager(io),
  prompter: {
    ask: async (q) => {
      process.stdout.write(q + (asks[0] === "" ? "⏎" : asks[0]) + "\n");
      return asks.shift() ?? "";
    },
    askSecret: async (q) => {
      process.stdout.write(q + "********\n");
      return secrets.shift() ?? "";
    },
  },
  smoke: async () => ({ ok: true, kind: "ok", detail: "已连通（HTTP 200，231ms）", latencyMs: 231 }),
  listModels: async (input) =>
    input.apiKey
      ? { ok: true, kind: "ok", ids: ["doubao-seed-evolving", "doubao-seed-2.0-pro"], detail: "实时模型列表：2 个模型" }
      : { ok: false, kind: "auth", ids: [], detail: "模型列表需要鉴权（展示内置目录）" },
  saveProfile: async () => {},
  dataDir: "~/.penglai",
});
console.log("\n=== RESULT ===", JSON.stringify(result));
