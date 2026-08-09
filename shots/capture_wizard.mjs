#!/usr/bin/env node
/**
 * shots/capture_wizard.mjs — 桌面首次启动向导的 CDP 截图驱动（真实 UI 旅程）。
 *
 * 用法：
 *   node capture_wizard.mjs <url> <mockBaseUrl> <outPrefix> [width] [height]
 *
 *   url         — dev_proxy.mjs 的静态+代理入口（如 http://localhost:1422）
 *   mockBaseUrl — serve_wizard.mts 打印的 MockModel 端点（填进自定义端点页）
 *   outPrefix   — 输出前缀，产出三张 PNG：
 *                 <outPrefix>-provider.png  供应商选择页（11 家目录 + 自定义端点）
 *                 <outPrefix>-model.png     模型选择页（实时 GET /models 合并）
 *                 <outPrefix>-identity.png  身份诞生页（自我介绍 + 种子 SOP 入树）
 *
 * 旅程全部真实驱动 React UI（点击/输入走原生事件），后端是真实 Host 的
 * config.listModels / config.smokeTest / config.createProfile /
 * onboarding.status / onboarding.birthIdentity —— 零手画 mock、零网络。
 * 不依赖 puppeteer；直接启动本机 Chrome（headless=new）走 DevTools 协议。
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";

const [url, mockBaseUrl, outPrefix, widthArg, heightArg] = process.argv.slice(2);
if (!url || !mockBaseUrl || !outPrefix) {
  console.error("usage: node capture_wizard.mjs <url> <mockBaseUrl> <outPrefix> [width] [height]");
  process.exit(2);
}
const width = Number(widthArg ?? 1600);
const height = Number(heightArg ?? 1000);

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, [
  "--headless=new",
  "--remote-debugging-port=0",
  "--hide-scrollbars",
  "--force-device-scale-factor=2",
  `--window-size=${width},${height}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--user-data-dir=/tmp/penglai-shot-chrome-wizard-profile",
  "about:blank",
]);

const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  chrome.stderr.on("data", (chunk) => {
    buf += chunk.toString();
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on("exit", () => reject(new Error("chrome exited early")));
  setTimeout(() => reject(new Error("timeout waiting for DevTools endpoint")), 15000);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let msgId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
  }
};

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send(
  "Emulation.setDeviceMetricsOverride",
  { width, height, deviceScaleFactor: 2, mobile: false },
  sessionId,
);

async function evaluate(expression) {
  const res = await send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (res.exceptionDetails) {
    throw new Error(`page evaluate failed: ${JSON.stringify(res.exceptionDetails).slice(0, 300)}`);
  }
  return res.result?.value;
}

/** 等页面里某个谓词为真（React 渲染/异步 RPC 就绪）。 */
async function waitFor(predicateExpr, label, timeoutMs = 15000) {
  const started = Date.now();
  for (;;) {
    const ok = await evaluate(`(() => Boolean(${predicateExpr}))()`);
    if (ok) return;
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting: ${label}`);
    await sleep(150);
  }
}

async function shot(out) {
  const shotRes = await send("Page.captureScreenshot", { format: "png" }, sessionId);
  fs.writeFileSync(out, Buffer.from(shotRes.data, "base64"));
  console.log(`[shots] saved ${out} (${fs.statSync(out).size} bytes)`);
}

// 页面侧助手：按文字点按钮、React 受控输入赋值。
await send("Page.navigate", { url }, sessionId);
for (let i = 0; i < 100; i += 1) {
  if (events.some((m) => m.method === "Page.loadEventFired" && m.sessionId === sessionId)) break;
  await sleep(100);
}
await evaluate(`(() => {
  window.__clickByText = (selector, text) => {
    const el = [...document.querySelectorAll(selector)]
      .find((e) => e.textContent.includes(text) && !e.disabled);
    if (!el) return false;
    el.click();
    return true;
  };
  window.__setInput = (selector, value) => {
    const el = document.querySelector(selector);
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  };
  return true;
})()`);

// ── 旅程 1：欢迎页 → 供应商选择页（真实目录渲染） ─────────────
await waitFor(`document.querySelector(".wizard-card")`, "wizard opens（无档案自动进向导）", 20000);
await sleep(600);
await evaluate(`window.__clickByText(".wizard-actions .primary-button", "开始")`);
await waitFor(`document.querySelectorAll(".wizard-option").length >= 10`, "provider rows");
await sleep(500);
await shot(`${outPrefix}-provider.png`);

// ── 旅程 2：自定义端点 → key → 实时模型列表 ───────────────────
await evaluate(`(() => {
  const opts = [...document.querySelectorAll(".wizard-option")];
  opts[opts.length - 1].click(); // custom 永远在目录最后
  return true;
})()`);
await sleep(250);
await evaluate(`window.__clickByText(".wizard-actions .primary-button", "下一步")`);
await waitFor(`document.querySelector(".wizard-field input")`, "custom base form");
await evaluate(`window.__setInput(".wizard-field input", ${JSON.stringify(mockBaseUrl)})`);
await sleep(200);
await evaluate(`window.__clickByText(".wizard-actions .primary-button", "下一步")`);
await waitFor(`document.querySelector('input[type="password"]')`, "custom key form");
await evaluate(`window.__setInput('input[type="password"]', "shot-local-key")`);
await sleep(200);
await evaluate(`window.__clickByText(".wizard-actions .primary-button", "下一步")`);
await waitFor(
  `document.querySelectorAll(".wizard-option-list .wizard-option").length >= 3`,
  "live model list（config.listModels 真实应答）",
);
await sleep(500);
await shot(`${outPrefix}-model.png`);

// ── 旅程 3：选模型 → 冒烟验证（真实 200）→ 保存 → 身份诞生 ────
await evaluate(`document.querySelector(".wizard-option-list .wizard-option").click()`);
await sleep(250);
await evaluate(`window.__clickByText(".wizard-actions .primary-button", "验证并保存")`);
await waitFor(`document.querySelector(".wizard-smoke.ok")`, "smoke ok（config.smokeTest 真实通过）", 35000);
await sleep(400);
await evaluate(`window.__clickByText(".wizard-smoke.ok .primary-button", "继续")`);
await waitFor(`document.querySelector(".wizard-identity input")`, "identity naming");
await evaluate(`window.__setInput(".wizard-identity input", "小蓬")`);
await sleep(250);
await evaluate(`window.__clickByText(".wizard-identity .primary-button", "举行诞生仪式")`);
await waitFor(
  `document.querySelector(".wizard-intro-card")`,
  "born view（onboarding.birthIdentity 真实落 L1 + 种子入树）",
);
await sleep(600);
await shot(`${outPrefix}-identity.png`);

ws.close();
chrome.kill("SIGKILL");
process.exit(0);
