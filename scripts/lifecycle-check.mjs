#!/usr/bin/env node
/**
 * scripts/lifecycle-check.mjs — 蓬莱 0.4 本机 unsigned lifecycle smoke
 * （安装/使用/卸载 + 更新配置静态核对；不执行真实升级）。
 *
 * 对象：packages/desktop/src-tauri/target/release/bundle 下的真实产物
 * （Penglai.app + Penglai_0.4.0_aarch64.dmg + Penglai.app.tar.gz[.sig]）。
 *
 * 用法：
 *   node scripts/lifecycle-check.mjs            # 全流程四阶段
 *   node scripts/lifecycle-check.mjs --keep     # 跑完保留 /tmp 现场（调试用）
 *
 * 隔离纪律：
 *   - app 拷贝到 /tmp/penglai-apps/（不动 /Applications）；
 *   - 一切数据写 PENGLAI_DATA_DIR=/tmp/penglai-lifecycle-*（不碰真实 ~/.penglai）；
 *   - 本机 14169 若被既有 `penglai serve` 占用：app 按产品语义复用既有 Host
 *     （不催生自己的 runtime），脚本**如实记录该偏差**，并改用沙盒端口
 *     （14175）直接启动安装包内嵌 host-runtime 完成「使用」阶段——这正是
 *     Tauri 壳 spawn 的同一个二进制+运行时，唯一差别是启动方与端口。
 *
 * 桌面 UI 层（首次启动向导）已由官网截图流水线的真实旅程验证
 * （shots/desktop-wizard-*.webp）；本脚本驱动 host 层 RPC 验证同一后端。
 */

import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { verifyUpdaterSignature } from "../packages/desktop/updater/release-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = path.join(ROOT, "packages/desktop/src-tauri/target/release/bundle");
const APP_IN_BUNDLE = path.join(BUNDLE, "macos/Penglai.app");
const DMG = path.join(BUNDLE, "dmg/Penglai_0.4.0_aarch64.dmg");
const UPDATER_TARBALL = path.join(BUNDLE, "macos/Penglai.app.tar.gz");
const UPDATER_SIG = `${UPDATER_TARBALL}.sig`;
const HOST_PORT = 14169;
const SANDBOX_PORT = 14175;
const KEEP = process.argv.includes("--keep");

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-lifecycle-"));
const APP_DIR = "/tmp/penglai-apps";
const APP_INSTALLED = path.join(APP_DIR, "Penglai.app");
const DATA_APP = path.join(BASE, "data-app");
const DATA_HOST = path.join(BASE, "data-host");
const HOME_DIR = path.join(BASE, "home");

const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", BOLD = "\x1b[1m", RESET = "\x1b[0m";
const lines = [];
let failures = 0;
function ok(text) { lines.push(`  ${GREEN}✓${RESET} ${text}`); }
function bad(text) { failures += 1; lines.push(`  ${RED}✗${RESET} ${text}`); }
function note(text) { lines.push(`  ${YELLOW}◦${RESET} ${text}`); }
function section(title) { lines.push(`\n${BOLD}${title}${RESET}`); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(port, timeoutMs = 30_000) {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    if (Date.now() - started > timeoutMs) return null;
    await sleep(300);
  }
}

async function rpc(port, token, method, params = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Penglai-Token": token },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

function portListenerPids(port) {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// ── 生命周期 mock 模型端点（OpenAI 兼容；零网络） ───────────────

function sseChunk(id, delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id, object: "chat.completion.chunk", created: 1_700_000_000, model: "mock-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

async function startMockModel() {
  const reply = "pong：生命周期验收应答（内嵌 host-runtime 真实驱动）";
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && (req.url ?? "").endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model" }] }));
      return;
    }
    if (req.method !== "POST" || !(req.url ?? "").endsWith("/v1/chat/completions")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "unknown route" } }));
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf-8")); } catch { /* 400 */ }
      if (body.stream === false) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: "chatcmpl-lifecycle", object: "chat.completion", created: 1_700_000_000, model: "mock-model",
          choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
        }));
        return;
      }
      const id = "chatcmpl-lifecycle";
      const parts = [];
      for (let i = 0; i < reply.length; i += 10) {
        parts.push(sseChunk(id, { role: i === 0 ? "assistant" : undefined, content: reply.slice(i, i + 10) }));
      }
      parts.push(sseChunk(id, {}, "stop"));
      parts.push(`data: ${JSON.stringify({
        id, object: "chat.completion.chunk", created: 1_700_000_000, model: "mock-model",
        choices: [], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
      })}\n\n`);
      parts.push("data: [DONE]\n\n");
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.end(parts.join(""));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

// ── 主流程 ──────────────────────────────────────────────────────

const procs = [];
let mockServer = null;
async function main() {
  section("0. 前置：产物与现场");
  for (const dir of [APP_DIR, DATA_APP, DATA_HOST, HOME_DIR]) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(APP_IN_BUNDLE)) { bad(`缺少 ${path.relative(ROOT, APP_IN_BUNDLE)}（先 tauri:build:local）`); return; }
  if (!fs.existsSync(DMG)) { bad(`缺少 ${path.relative(ROOT, DMG)}`); return; }
  ok(`产物在位：Penglai.app、${path.basename(DMG)}（${(fs.statSync(DMG).size / 1048576).toFixed(1)}MB）`);
  const plistVersion = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", `${APP_IN_BUNDLE}/Contents/Info.plist`], { encoding: "utf-8" }).trim();
  const plistId = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", `${APP_IN_BUNDLE}/Contents/Info.plist`], { encoding: "utf-8" }).trim();
  if (plistVersion === "0.4.0" && plistId === "com.penglai.agent") ok(`包身份：${plistId} · v${plistVersion}`);
  else bad(`包身份异常：${plistId} · v${plistVersion}`);
  const occupied = portListenerPids(HOST_PORT);
  if (occupied.length > 0) {
    note(`本机 ${HOST_PORT} 被既有进程（pid ${occupied.join("/")}，判断为 owner 的 dev serve）占用——` +
      "不动它；app 按产品语义复用既有 Host，「内嵌 runtime 拉起」改以沙盒端口 " +
      `${SANDBOX_PORT} 直接验证（同一二进制+运行时）。`);
  } else {
    note(`${HOST_PORT} 空闲：app 将自行拉起内嵌 runtime（本次验证覆盖该路径）。`);
  }

  // ── 1. 安装 ──
  section("1. 安装（DMG 挂载 → 隔离目录 → 去隔离 → 首启）");
  const mountPoint = path.join(BASE, "mnt");
  fs.mkdirSync(mountPoint, { recursive: true });
  execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mountPoint, DMG]);
  try {
    if (!fs.existsSync(path.join(mountPoint, "Penglai.app"))) bad("DMG 内无 Penglai.app");
    else if (!fs.existsSync(path.join(mountPoint, "Applications"))) bad("DMG 内无 /Applications 快捷方式");
    else ok("DMG 内容正确（Penglai.app + Applications 快捷方式）");
    fs.rmSync(APP_INSTALLED, { recursive: true, force: true });
    execFileSync("ditto", [path.join(mountPoint, "Penglai.app"), APP_INSTALLED]);
  } finally {
    execFileSync("hdiutil", ["detach", mountPoint], { stdio: "ignore" });
  }
  ok(`已拷贝到隔离目录 ${APP_DIR}（未动 /Applications）`);
  try {
    execFileSync("xattr", ["-dr", "com.apple.quarantine", APP_INSTALLED]);
    ok("已去隔离属性（xattr -dr com.apple.quarantine）");
  } catch { note("无隔离属性可去（本地构建产物，正常）"); }
  // codesign -dv 的信息全部写在 stderr，用 spawnSync 两流都收。
  const { spawnSync } = await import("node:child_process");
  const signRun = spawnSync("codesign", ["-dv", APP_INSTALLED], { encoding: "utf-8" });
  const signInfo = `${signRun.stdout ?? ""}\n${signRun.stderr ?? ""}`;
  if (/Signature=adhoc/.test(signInfo)) note("签名为 adhoc（仅本地 --no-sign smoke；不构成 Developer ID 或 notarization 证据）");
  else if (/Authority=Developer ID/.test(signInfo)) note("检测到 Developer ID 签名；本脚本未验证 notarization ticket，不能据此宣称 Apple 信任链完整");
  else note(`签名形态：${signInfo.split("\n").find((l) => l.startsWith("Signature")) ?? "未知"}`);

  // 首次启动（Tauri 壳本体）
  const appBin = `${APP_INSTALLED}/Contents/MacOS/penglai-desktop-04`;
  if (!fs.existsSync(appBin)) { bad("app 主二进制缺失"); }
  else {
    const appProc = spawn(appBin, [], {
      env: { ...process.env, PENGLAI_DATA_DIR: DATA_APP },
      stdio: ["ignore", "ignore", "pipe"],
    });
    procs.push(appProc);
    let appLog = "";
    appProc.stderr.on("data", (c) => { appLog += c.toString(); });
    await sleep(6000);
    if (appProc.exitCode === null && !appProc.killed) {
      ok("Tauri 壳首次启动存活（6s 观察窗）");
      if (occupied.length > 0) {
        note("因 14169 被占用，壳按设计复用既有 Host（未催生内嵌 runtime）");
      } else {
        const health = await waitHealth(HOST_PORT, 20_000);
        if (health?.runtime === "host") ok("壳自行拉起的内嵌 runtime 通过 /health 握手");
        else bad("壳未能拉起内嵌 runtime");
      }
    } else {
      bad(`Tauri 壳启动即退出（exit ${appProc.exitCode}）：${appLog.slice(0, 200)}`);
    }
    if (appProc.exitCode === null) {
      appProc.kill("SIGTERM");
      await sleep(1500);
      if (appProc.exitCode === null) appProc.kill("SIGKILL");
    }
    ok("壳已退出（SIGTERM，未动既有 Host）");
  }

  // ── 2. 使用（沙盒端口直启内嵌 runtime，全 RPC 生命周期） ──
  section("2. 使用（内嵌 host-runtime 拉起 / 数据隔离 / 向导档案 / mock chat 冒烟）");
  const runtimeRoot = ["Contents/Resources/resources/host-runtime", "Contents/Resources/host-runtime"]
    .map((rel) => path.join(APP_INSTALLED, rel))
    .find((p) => fs.existsSync(path.join(p, "manifest.json")));
  if (!runtimeRoot) { bad("app 内未找到 host-runtime/manifest.json"); return; }
  ok(`内嵌 runtime 在位：${path.relative(APP_INSTALLED, runtimeRoot)}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "manifest.json"), "utf-8"));
  if (manifest.productVersion === "0.4.0" && manifest.entry === "src/cli.js") {
    ok(`runtime 清单：v${manifest.productVersion} · entry ${manifest.entry} · ${manifest.fileCount} 文件`);
  } else bad("runtime 清单字段异常");
  if (manifest.databaseSchemaVersion === 7 && manifest.protocolSchemaVersion === 1) {
    ok(`runtime 清单 schema：protocol v${manifest.protocolSchemaVersion} · database v${manifest.databaseSchemaVersion}`);
  } else bad(`runtime 清单 schema 异常：protocol=${manifest.protocolSchemaVersion} database=${manifest.databaseSchemaVersion}（期望 1/7）`);
  // 完整性抽查：node 二进制 sha256 须与清单一致（app 启动时全量校验，这里抽验核心）。
  const nodeBin = path.join(runtimeRoot, manifest.node.path);
  const nodeHash = execFileSync("shasum", ["-a", "256", nodeBin], { encoding: "utf-8" }).split(" ")[0];
  if (nodeHash === manifest.node.sha256) ok("内嵌 Node 二进制哈希与清单一致（sha256 抽验）");
  else bad("内嵌 Node 二进制哈希不符");

  const hostProc = spawn(nodeBin, [path.join(runtimeRoot, manifest.entry), "serve", "--port", String(SANDBOX_PORT)], {
    env: { ...process.env, PENGLAI_DATA_DIR: DATA_HOST },
    stdio: ["ignore", "ignore", "pipe"],
  });
  procs.push(hostProc);
  let hostLog = "";
  hostProc.stderr.on("data", (c) => { hostLog += c.toString(); });
  const handshake = await waitHealth(SANDBOX_PORT, 30_000);
  if (!handshake) {
    bad(`内嵌 runtime 未在 30s 内就绪：${hostLog.slice(0, 300)}`);
    return;
  }
  if (
    handshake.product === "Penglai" &&
    handshake.runtime === "host" &&
    handshake.protocolSchemaVersion === 1 &&
    handshake.databaseSchemaVersion === 7
  ) {
    ok(`握手通过：${handshake.product} ${handshake.productVersion} · 协议 v${handshake.protocolSchemaVersion} · 数据库 v${handshake.databaseSchemaVersion} · 实例 ${String(handshake.instanceId).slice(0, 8)}`);
  } else bad(`握手字段异常：${JSON.stringify(handshake).slice(0, 200)}`);

  if (fs.existsSync(path.join(DATA_HOST, "host.token")) && fs.existsSync(path.join(DATA_HOST, "product.db"))) {
    ok(`数据目录隔离生效：沙盒内 host.token + product.db（端口 ${SANDBOX_PORT}，非 ${HOST_PORT}）`);
  } else bad("沙盒数据目录缺 host.token 或 product.db");
  const token = fs.readFileSync(path.join(DATA_HOST, "host.token"), "utf-8").trim();

  // 向导档案（host 层；UI 层已由截图流水线验证，见文件头注释）
  const mock = await startMockModel();
  mockServer = mock.server;
  const profiles = await rpc(SANDBOX_PORT, token, "config.listProfiles");
  if (Array.isArray(profiles) && profiles.length >= 3) ok(`内置目录档案在位（${profiles.length} 个，env 引用型）`);
  else bad("内置目录档案缺失");
  const created = await rpc(SANDBOX_PORT, token, "config.createProfile", {
    id: "lifecycle-mock",
    label: "生命周期验收档案",
    provider: "custom",
    baseUrl: mock.baseUrl,
    model: "mock-model",
    apiKey: "lifecycle-demo-key",
  });
  if (created?.id === "lifecycle-mock") ok("config.createProfile 成功（模拟向导保存）");
  else bad("config.createProfile 返回异常");
  const profilesFile = path.join(DATA_HOST, "profiles.json");
  if (fs.existsSync(profilesFile)) {
    const mode = fs.statSync(profilesFile).mode & 0o777;
    const content = fs.readFileSync(profilesFile, "utf-8");
    if (mode === 0o600 && content.includes("lifecycle-mock") && content.includes("lifecycle-demo-key")) {
      ok("profiles.json 落盘：0600 私密权限 + 档案与 key 在内（host 侧保管）");
    } else bad(`profiles.json 权限 ${mode.toString(8)} 或内容不符`);
  } else bad("profiles.json 未生成");
  const resolved = await rpc(SANDBOX_PORT, token, "config.resolveProfile", {});
  if (resolved?.profile?.id === "lifecycle-mock" && resolved.hasKey) ok("config.resolveProfile 立即可用（向导后状态）");
  else bad("resolveProfile 未命中新档案");
  const smoke = await rpc(SANDBOX_PORT, token, "config.smokeTest", {
    baseUrl: mock.baseUrl, model: "mock-model", apiKey: "lifecycle-demo-key",
  });
  if (smoke?.ok) ok(`冒烟验证通过（${smoke.detail}）`);
  else bad(`冒烟验证失败：${smoke?.detail}`);

  // 身份诞生（onboarding RPC，沙盒记忆）
  const status0 = await rpc(SANDBOX_PORT, token, "onboarding.status");
  const birth = await rpc(SANDBOX_PORT, token, "onboarding.birthIdentity", { name: "生命周期" });
  const status1 = await rpc(SANDBOX_PORT, token, "onboarding.status");
  if (status0.identity === null && birth.ran === true && status1.identity?.name === "生命周期") {
    ok("身份诞生 RPC：未诞生 → 举行 → 可读回（种子 SOP 过审入树）");
  } else bad("身份诞生 RPC 行为异常");

  // mock chat 冒烟（真实内核整回合）
  const ws = await rpc(SANDBOX_PORT, token, "workspace.open", { rootPath: HOME_DIR, name: "lifecycle" });
  const conv = await rpc(SANDBOX_PORT, token, "conversation.create", {
    workspaceId: ws.id, modelProfileId: "lifecycle-mock", title: "生命周期验收",
  });
  await rpc(SANDBOX_PORT, token, "conversation.prompt", { conversationId: conv.id, text: "ping" });
  const after = await rpc(SANDBOX_PORT, token, "conversation.get", { conversationId: conv.id });
  const assistantText = (after.messages ?? [])
    .filter((m) => m.role === "assistant")
    .map((m) => (m.content ?? []).map((p) => p.text ?? "").join(""))
    .join("\n");
  if (assistantText.includes("生命周期验收应答")) ok("chat 冒烟：mock 模型整回合应答落 transcript");
  else bad(`chat 冒烟应答缺失：${assistantText.slice(0, 120)}`);
  const usage = await rpc(SANDBOX_PORT, token, "usage.get");
  if (usage?.totalTokens > 0) ok(`用量账本记录到账（${usage.totalTokens} tokens / ${usage.totalRequests} 次请求）`);
  else bad("用量账本为空");

  // 常用交付面：工作区内产物预览 + 明确脱敏的诊断包导出。
  const previewFile = path.join(HOME_DIR, "lifecycle-preview.md");
  fs.writeFileSync(previewFile, "# DMG 产物预览\n来自安装包内嵌 runtime。\n", "utf-8");
  const previewProject = await rpc(SANDBOX_PORT, token, "project.create", {
    rootPath: HOME_DIR,
    name: "lifecycle-artifact",
  });
  const previewTask = await rpc(SANDBOX_PORT, token, "task.create", {
    projectId: previewProject.id,
    title: "预览安装包产物",
    objective: "验证桌面证据栏的只读预览",
    sourceChannel: "desktop",
  });
  const previewEvidence = await rpc(SANDBOX_PORT, token, "evidence.add", {
    taskId: previewTask.id,
    kind: "artifact",
    title: "lifecycle-preview.md",
    uri: "lifecycle-preview.md",
  });
  const preview = await rpc(SANDBOX_PORT, token, "artifact.preview", {
    taskId: previewTask.id,
    evidenceId: previewEvidence.id,
  });
  if (
    preview?.format === "md" &&
    preview?.text?.includes("来自安装包内嵌 runtime") &&
    preview?.truncated === false
  ) ok("artifact.preview：工作区监禁内的 Markdown 只读预览通过");
  else bad(`artifact.preview 返回异常：${JSON.stringify(preview).slice(0, 180)}`);

  const diagnosticLogDir = path.join(DATA_HOST, "logs");
  fs.mkdirSync(diagnosticLogDir, { recursive: true });
  fs.writeFileSync(
    path.join(diagnosticLogDir, "lifecycle.log"),
    `Bearer lifecycle-private-token\napi_key=lifecycle-private-key\npath=${os.homedir()}/private-workspace\nok\n`,
    "utf-8",
  );
  const diagnostic = await rpc(SANDBOX_PORT, token, "doctor.export");
  let diagnosticText = "";
  try {
    const entries = unzipSync(fs.readFileSync(diagnostic.path));
    diagnosticText = Object.values(entries).map((entry) => strFromU8(entry)).join("\n");
  } catch (error) {
    bad(`诊断包无法解压：${error instanceof Error ? error.message : String(error)}`);
  }
  const diagnosticMode = fs.statSync(diagnostic.path).mode & 0o777;
  if (
    diagnostic.path.startsWith(path.join(DATA_HOST, "diagnostics")) &&
    diagnosticMode === 0o600 &&
    diagnostic.redactions >= 3 &&
    diagnosticText.includes("[REDACTED]") &&
    !diagnosticText.includes("lifecycle-private-token") &&
    !diagnosticText.includes("lifecycle-private-key") &&
    !diagnosticText.includes(os.homedir())
  ) ok(`doctor.export：诊断包可解压、0600、已脱敏（${diagnostic.redactions} 处）`);
  else bad("doctor.export 诊断包路径、权限或脱敏验证失败");

  // ── 3. 卸载 ──
  section("3. 卸载（退出 → 无残留进程/端口 → 删除）");
  mockServer?.close();
  hostProc.kill("SIGTERM");
  await sleep(2000);
  if (hostProc.exitCode === null) hostProc.kill("SIGKILL");
  await sleep(1000);
  const leftover = portListenerPids(SANDBOX_PORT);
  if (leftover.length === 0) ok(`沙盒端口 ${SANDBOX_PORT} 已释放，无残留监听`);
  else bad(`端口 ${SANDBOX_PORT} 仍被占用（pid ${leftover.join("/")}）`);
  const stray = (() => {
    try {
      return execFileSync("sh", ["-c", `ps aux | grep -F "${BASE}" | grep -v grep || true`], { encoding: "utf-8" }).trim();
    } catch { return ""; }
  })();
  if (!stray) ok("无残留进程（沙盒路径扫描）");
  else bad(`残留进程：${stray.split("\n")[0].slice(0, 120)}`);
  if (!KEEP) {
    fs.rmSync(APP_DIR, { recursive: true, force: true });
    if (!fs.existsSync(APP_INSTALLED)) ok("隔离 app 已删除（卸载动作完成）");
    else bad("app 删除失败");
  } else {
    note(`--keep：现场保留在 ${BASE} 与 ${APP_DIR}`);
  }
  note("owner 视角卸载路径见 docs/UNINSTALL.md（app 删除 + 可选删除 ~/.penglai + 凭证说明）");

  // ── 4. 升级 ──
  section("4. 更新配置静态核对（不执行真实升级；canary 属 CI draft/真机）");
  const conf = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/desktop/src-tauri/tauri.conf.json"), "utf-8"));
  const pubkey = Buffer.from(conf.plugins.updater.pubkey, "base64").toString("utf-8");
  if (/minisign public key: [0-9A-F]{16}/.test(pubkey) && !pubkey.includes("270552BCE2E63863")) {
    ok(`updater 公钥为真实密钥对（${pubkey.split("\n")[0].replace(/^.*: /, "")}），非文档示例`);
  } else bad("updater 公钥仍是 tauri 文档示例");
  const endpoints = conf.plugins.updater.endpoints ?? [];
  if (
    endpoints.some(
      (e) =>
        e ===
        "https://github.com/kevinchennewbee/PenglaiAgent/releases/download/desktop-v0.4/latest.json",
    ) && endpoints.every((e) => !e.includes("/releases/latest/"))
  ) {
    ok("endpoint 固定到 desktop-v0.4 元数据通道（不受 0.3 latest 影响）");
  } else bad("endpoint 配置异常");
  if (conf.bundle.targets.includes("app") && conf.bundle.createUpdaterArtifacts === true) {
    ok("bundle.targets 含 app（macOS 更新包 .app.tar.gz 产出前提）+ createUpdaterArtifacts");
  } else bad("bundle.targets 缺 app 或未开 createUpdaterArtifacts（本刀已修）");
  if (fs.existsSync(UPDATER_TARBALL) && fs.existsSync(UPDATER_SIG)) {
    try {
      verifyUpdaterSignature(
        fs.readFileSync(UPDATER_TARBALL),
        fs.readFileSync(UPDATER_SIG, "utf-8").trim(),
        conf.plugins.updater.pubkey,
      );
      ok("本地更新包通过内置 0.4 公钥的真实 minisign 验证");
    } catch (error) {
      bad(`更新包 minisign 验证失败：${error instanceof Error ? error.message : String(error)}`);
    }
  } else note("更新包/签名未在本地产出；本地 unsigned smoke 不能替代 Owner key、CI draft asset 和下载回读验签证据");
  note("真实 0.4.0→0.4.1 升级演练（latest.json 指向 → 检查更新 → 通知 → 验签下载 → 备份 → 安装重启）属 CI 发布链与真机 dogfood，本脚本未执行");

  // ── 结论 ──
  section("结论");
  if (failures === 0) lines.push(`  ${GREEN}${BOLD}本机 unsigned lifecycle smoke 通过${RESET}（安装/使用/卸载；未证明 Developer ID/notarization、正式签名或 0.4.0→0.4.1 canary 更新）`);
  else lines.push(`  ${RED}${BOLD}验收未通过：${failures} 项失败${RESET}`);
}

try {
  await main();
} finally {
  for (const proc of procs) {
    try { if (proc.exitCode === null) proc.kill("SIGKILL"); } catch { /* gone */ }
  }
  try { mockServer?.close(); } catch { /* closed */ }
  if (!KEEP) {
    try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* fine */ }
    try { fs.rmSync(APP_DIR, { recursive: true, force: true }); } catch { /* fine */ }
  }
  console.log(lines.join("\n"));
  console.log(`\n（沙盒 ${BASE}${KEEP ? " 已保留" : " 已清理"}）`);
  process.exit(failures === 0 ? 0 : 1);
}
