#!/usr/bin/env node
/**
 * shots/capture.mjs — headless Chrome CDP 截图驱动（Node ≥22 内置 WebSocket）。
 *
 * 用法：
 *   node capture.mjs <url> <out.png> [width] [height] [clickExpr] [settleMs]
 *
 *   clickExpr — 可选，页面加载稳定后在页面里 evaluate 的 JS（如点击侧栏任务行）。
 *
 * 不依赖 puppeteer；直接启动本机 Chrome（headless=new）并走 DevTools 协议。
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";

const [url, out, widthArg, heightArg, clickExpr, settleArg] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node capture.mjs <url> <out.png> [width] [height] [clickExpr] [settleMs]");
  process.exit(2);
}
const width = Number(widthArg ?? 1600);
const height = Number(heightArg ?? 1000);
const settleMs = Number(settleArg ?? 2500);

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, [
  "--headless=new",
  "--remote-debugging-port=0",
  "--hide-scrollbars",
  "--force-device-scale-factor=2",
  `--window-size=${width},${height}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--user-data-dir=/tmp/penglai-shot-chrome-profile",
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
await send("Page.navigate", { url }, sessionId);

// 等 load 事件 + 应用渲染稳定
for (let i = 0; i < 100; i += 1) {
  if (events.some((m) => m.method === "Page.loadEventFired" && m.sessionId === sessionId)) break;
  await sleep(100);
}
await sleep(settleMs);

if (clickExpr) {
  await send("Runtime.evaluate", { expression: clickExpr, awaitPromise: false }, sessionId);
  await sleep(1800);
}

const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
fs.mkdirSync(new URL(".", `file://${out}`).pathname, { recursive: true });
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log(`[shots] saved ${out} (${fs.statSync(out).size} bytes)`);

ws.close();
chrome.kill("SIGKILL");
process.exit(0);
