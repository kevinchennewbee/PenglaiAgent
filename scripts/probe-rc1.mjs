import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";

const outDir = join(ROOT, "evidence/generated");
mkdirSync(outDir, { recursive: true });

const { captureCapabilityBaseline, assertCapabilityBaseline } = await import(
  pathToFileURL(join(ROOT, "packages/dsh-bridge/src/capability-baseline.ts")).href
);
const baseline = captureCapabilityBaseline();
assertCapabilityBaseline(baseline);

const req = createRequire(join(ROOT, "packages/channel-feishu/package.json"));
const larkPkg = req("@larksuiteoapi/node-sdk/package.json");
const lark = req("@larksuiteoapi/node-sdk");
const larkOk = {
  version: larkPkg.version,
  hasClient: typeof (lark.Client ?? lark.default?.Client) === "function",
  hasWSClient: typeof (lark.WSClient ?? lark.default?.WSClient) === "function",
  hasEventDispatcher: typeof (lark.EventDispatcher ?? lark.default?.EventDispatcher) === "function",
};
if (larkOk.version !== "1.73.0" || !larkOk.hasClient || !larkOk.hasWSClient || !larkOk.hasEventDispatcher) {
  console.error("lark sdk pin/API probe failed", larkOk);
  process.exit(1);
}

const rec = {
  command: "probe:rc1",
  dsh: baseline,
  weixin: {
    referenceCommit: "cef0bfc390393f716903e16d50408118047f87e0",
    qrStatuses: [
      "wait",
      "scaned",
      "confirmed",
      "expired",
      "scaned_but_redirect",
      "need_verifycode",
      "verify_code_blocked",
      "binded_redirect",
    ],
    qrTtlMs: 300000,
    pollTimeoutMs: 35000,
    uin: "base64(random uint32)",
    openclawRuntime: false,
  },
  feishu: {
    sdk: larkOk,
    commit: "f54b49f3566c52b54c598194b7ed3015e3e24224",
    event: "im.message.receive_v1",
    mode: "long_connection",
    deviceFlowIsBaseAuth: false,
    openclawRuntime: false,
  },
};
writeFileSync(join(outDir, "rc1-contracts.json"), JSON.stringify(rec, null, 2));
console.log("probe-rc1", JSON.stringify({ dsh: baseline.dsh, lark: larkOk.version, overlay: baseline.overlay.sidebarWordmarkHasNameProp }));
