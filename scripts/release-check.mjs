#!/usr/bin/env node
/**
 * 蓬莱 0.4.0 发布门禁（release gate）
 *
 * 用法：
 *   node scripts/release-check.mjs                 # 全量七项检查
 *   node scripts/release-check.mjs --only=scan,deps,files,statement   # 只跑指定项
 *   node scripts/release-check.mjs --skip=tests    # 跳过指定项（慢项调试）
 *
 * 检查项：
 *   ① 全量 vitest + eval 回放全绿
 *   ② tsc --noEmit 三包（protocol / host / desktop）
 *   ③ vite build（desktop）
 *   ④ 隐私/密钥扫描（全部 git 跟踪文件；假测试 fixture 走显式白名单）
 *   ⑤ 依赖许可证扫描（Earendil/Pi 必须 MIT；全 lock 无 copyleft）
 *   ⑥ 无禁推文件混入（内部设计文档/密钥文件/未放行 docs）
 *   ⑦ 0.3 Python 存量与 0.4 的关系声明存在（README）
 *   ⑧ schema 单一真相源交叉校验（protocol/Rust/manifest 脚本）
 *
 * 结论：全部通过 → 「可推送」；任一项失败 → 「不可推送」，exit 1。
 * 本脚本只读仓库与执行构建/测试命令，不修改任何跟踪文件，绝不执行 push。
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", RESET = "\x1b[0m", BOLD = "\x1b[1m";
const ok = (s) => `${GREEN}✓${RESET} ${s}`;
const bad = (s) => `${RED}✗${RESET} ${s}`;
const warn = (s) => `${YELLOW}!${RESET} ${s}`;

const CHECKS = ["tests", "tsc", "build", "scan", "deps", "files", "statement", "schema"];
const argOnly = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const argSkip = (process.argv.find((a) => a.startsWith("--skip=")) || "").slice(7).split(",").filter(Boolean);
const enabled = (name) => (argOnly.length === 0 || argOnly.includes(name)) && !argSkip.includes(name);

const results = []; // { id, title, pass, lines: string[] }
function record(id, title, pass, lines) {
  results.push({ id, title, pass, lines });
  console.log(`\n${BOLD}${title}${RESET}`);
  for (const line of lines) console.log(`  ${line}`);
  console.log(pass ? `  ${ok("通过")}` : `  ${bad("未通过")}`);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT, encoding: "utf8", timeout: opts.timeoutMs ?? 280_000,
    env: { ...process.env, CI: "1", NO_COLOR: "1", ...(opts.env || {}) },
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: res.status ?? (res.error ? 1 : 0),
    out: `${res.stdout || ""}\n${res.stderr || ""}`,
    error: res.error ? String(res.error.message || res.error) : null,
  };
}

function gitTrackedFiles() {
  const out = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

// ────────────────────────────────────────────────────────────
// ① 全量 vitest + eval
// ────────────────────────────────────────────────────────────
function checkTests() {
  const lines = [];
  let pass = true;
  const full = run("npx", ["vitest", "run"], { timeoutMs: 280_000 });
  const mFiles = full.out.match(/Test Files\s+(\d+) passed(?:\s+\((\d+)\))?/);
  const mTests = full.out.match(/Tests\s+(\d+) passed(?:\s+\((\d+)\))?/);
  const failed = /(\d+) failed/.test(full.out) && !/0 failed/.test(full.out);
  if (full.code !== 0 || failed || !mTests) {
    pass = false;
    lines.push(bad(`全量 vitest 失败（exit ${full.code}${full.error ? `, ${full.error}` : ""}）`));
    lines.push(DIM + full.out.split("\n").slice(-25).join("\n") + RESET);
  } else {
    lines.push(ok(`全量 vitest：${mTests[1]} 测试通过 / ${mFiles ? mFiles[1] : "?"} 文件，0 失败`));
  }
  // Eval 回放（E01–E17）在 vitest 的 include 模式内已随全量跑过一遍；此处
  // 单独跑 eval 目录只为显式确认 eval 子集独立可跑，不再重复全量。
  const evalRun = run("npx", ["vitest", "run", "packages/host/test/eval"], { timeoutMs: 280_000 });
  const mEval = evalRun.out.match(/Tests\s+(\d+) passed/);
  const evalFailed = /(\d+) failed/.test(evalRun.out) && !/0 failed/.test(evalRun.out);
  if (evalRun.code !== 0 || evalFailed || !mEval) {
    pass = false;
    lines.push(bad(`eval 回放失败（exit ${evalRun.code}）`));
    lines.push(DIM + evalRun.out.split("\n").slice(-25).join("\n") + RESET);
  } else {
    lines.push(ok(`eval 回放：${mEval[1]} 条（E01–E17）全部通过`));
  }
  record("tests", "① 全量 vitest + eval 回放", pass, lines);
}

// ────────────────────────────────────────────────────────────
// ② tsc --noEmit 三包
// ────────────────────────────────────────────────────────────
function checkTsc() {
  const lines = [];
  let pass = true;
  for (const pkg of ["@penglai/protocol", "@penglai/host", "@penglai/desktop"]) {
    const r = run("npm", ["run", "typecheck", "-w", pkg], { timeoutMs: 180_000 });
    if (r.code === 0) lines.push(ok(`tsc --noEmit ${pkg}`));
    else {
      pass = false;
      lines.push(bad(`tsc --noEmit ${pkg} 失败（exit ${r.code}）`));
      lines.push(DIM + r.out.split("\n").slice(-15).join("\n") + RESET);
    }
  }
  record("tsc", "② TypeScript 三包类型检查", pass, lines);
}

// ────────────────────────────────────────────────────────────
// ③ vite build（desktop）
// ────────────────────────────────────────────────────────────
function checkBuild() {
  const lines = [];
  const r = run("npm", ["run", "build", "-w", "@penglai/desktop"], { timeoutMs: 240_000 });
  const pass = r.code === 0 && /built in|✓ built/i.test(r.out);
  if (pass) {
    const m = r.out.match(/built in ([\d.]+[a-z]+)/i);
    lines.push(ok(`vite build @penglai/desktop 成功${m ? `（${m[1]}）` : ""}`));
  } else {
    lines.push(bad(`vite build 失败（exit ${r.code}）`));
    lines.push(DIM + r.out.split("\n").slice(-20).join("\n") + RESET);
  }
  record("build", "③ 桌面 vite build", pass, lines);
}

// ────────────────────────────────────────────────────────────
// ④ 隐私/密钥扫描
// ────────────────────────────────────────────────────────────
const SCAN_RULES = [
  { id: "openai-key", desc: "OpenAI 风格密钥（sk-…）", re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { id: "github-token", desc: "GitHub token（ghp_/github_pat_ 等）", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { id: "google-key", desc: "Google API key（AIza…）", re: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { id: "slack-token", desc: "Slack token（xox…）", re: /\bxox[bpoas]-[A-Za-z0-9-]{10,}\b/g },
  { id: "private-key-block", desc: "PEM 私钥块", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: "minisign-secret", desc: "minisign 加密私钥块（Tauri updater 签名私钥）", re: /untrusted comment: minisign encrypted secret key/g },
  { id: "aws-key", desc: "AWS Access Key（AKIA…）", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "phone-cn", desc: "中国大陆手机号", re: /(?<![0-9a-fA-F])1[3-9]\d{9}(?!\d)/g },
  { id: "email", desc: "邮箱地址", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { id: "webhook-url", desc: "IM webhook 地址（含密钥参数）", re: /https?:\/\/[^\s"'`)\]]*(?:\/robot\/send\?access_token=|cgi-bin\/webhook\/send\?key=|open-apis\/bot\/v2\/hook\/|hooks\.slack\.com\/services\/)[^\s"'`)\]]*/gi },
  { id: "intranet-ip", desc: "内网 IP（10/8、172.16/12、192.168/16）", re: /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g },
  { id: "personal-path", desc: "个人机器路径（/Users/、/home/、C:\\Users\\、/Volumes/）", re: /\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|[A-Z]:\\Users\\|\/Volumes\/[A-Za-z0-9._-]+/g },
];

// 白名单：显式列出每一处「看起来像但确认不是真实秘密」的命中。
// 新增命中若确属假 fixture，在此追加并写明理由；真实秘密必须就地清除，不得入白名单。
const SCAN_WHITELIST = [
  // —— 0.4 测试 fixture（合成密钥，测试断言之用，非真实凭证）——
  { rule: "openai-key", file: /^packages\/host\/test\//, match: "sk-fixture0000000000000000000000deadbeef", reason: "迁移测试合成 fixture key" },
  { rule: "openai-key", file: /^packages\/host\/test\//, match: "sk-relayfixture1111111111111111cafe", reason: "迁移测试合成 fixture key" },
  { rule: "openai-key", file: /^packages\/host\/test\//, match: "sk-owner-other-key-000000000000", reason: "迁移测试合成 fixture key" },
  { rule: "openai-key", file: /^packages\/host\/test\//, match: "sk-user-fixture2222222222222222beef", reason: "迁移测试合成 fixture key" },
  { rule: "openai-key", file: /^packages\/host\/test\//, match: "sk-half333333333333333333333333", reason: "迁移测试合成半成品 key" },
  // —— 0.3 Python 测试 fixture（合成密钥，用于打码/拦截断言）——
  { rule: "openai-key", file: /^tests\//, match: "sk-1234567890abcdef", reason: "0.3 打码测试合成 key" },
  { rule: "openai-key", file: /^tests\//, match: "sk-testsecret123456", reason: "0.3 打码测试合成 key" },
  { rule: "email", file: /^tests\/test_redline\.py$/, match: "PASSWORD123456", reason: "0.3 红线测试合成 URL 凭证" },
  // —— SSRF 防护测试的 RFC1918 合成地址（测试数据，非真实内网）——
  { rule: "intranet-ip", file: /^tests\/test_summarize\.py$/, reason: "0.3 SSRF 防护测试合成私网地址" },
  // —— 专用服务账户示例（安全加固建议中名为 "penglai" 的专用账户，非 owner 个人路径）——
  { rule: "personal-path", file: /^penglai_runtime\//, match: "/home/penglai", reason: "0.3 systemd 单元示例的专用服务账户 home" },
  { rule: "personal-path", file: /^penglai_runtime\//, match: "/Users/penglai", reason: "0.3 launchd plist 示例的专用服务账户 home" },
  { rule: "personal-path", file: /^tests\//, match: "/home/penglai", reason: "上述示例的测试断言" },
  { rule: "personal-path", file: /^tests\//, match: "/Users/penglai", reason: "上述示例的测试断言" },
  // —— bash-guard 攻击样本（H1/H2 回归测试的合成越狱/外发命令，非 owner 路径）——
  { rule: "personal-path", file: /^packages\/host\/test\/bash-guard\.test\.ts$/, match: "/Users/x", reason: "H1 攻击样本（cp /Users/x/token.txt …）合成路径" },
  { rule: "personal-path", file: /^packages\/host\/test\/policy\.test\.ts$/, match: "/Users/x", reason: "H1 L4 策略回归样本（cp /Users/x/token.txt …）合成路径" },
  // —— 本脚本自身：白名单声明里的 /Users/x 字面量会被扫描器命中（自引用）——
  { rule: "personal-path", file: /^scripts\/release-check\.mjs$/, match: "/Users/x", reason: "本表 H1 攻击样本声明自引用" },
  // —— 本脚本自身：白名单声明里的字符串会被扫描器命中（自引用）。仅放行与本表
  //    逐字相同的 fixture 字面量；脚本其余位置出现任何真实密钥仍会命中报警。——
  { rule: "openai-key", file: /^scripts\/release-check\.mjs$/, match: "sk-fixture0000000000000000000000deadbeef", reason: "本表 fixture 声明自引用" },
  { rule: "openai-key", file: /^scripts\/release-check\.mjs$/, match: "sk-relayfixture1111111111111111cafe", reason: "本表 fixture 声明自引用" },
  { rule: "openai-key", file: /^scripts\/release-check\.mjs$/, match: "sk-owner-other-key-000000000000", reason: "本表 fixture 声明自引用" },
  { rule: "openai-key", file: /^scripts\/release-check\.mjs$/, match: "sk-user-fixture2222222222222222beef", reason: "本表 fixture 声明自引用" },
  { rule: "openai-key", file: /^scripts\/release-check\.mjs$/, match: "sk-half333333333333333333333333", reason: "本表 fixture 声明自引用" },
  { rule: "openai-key", file: /^scripts\/release-check\.mjs$/, match: "sk-1234567890abcdef", reason: "本表 fixture 声明自引用" },
  { rule: "openai-key", file: /^scripts\/release-check\.mjs$/, match: "sk-testsecret123456", reason: "本表 fixture 声明自引用" },
  { rule: "personal-path", file: /^scripts\/release-check\.mjs$/, match: "/home/penglai", reason: "本表服务账户示例声明自引用" },
  { rule: "personal-path", file: /^scripts\/release-check\.mjs$/, match: "/Users/penglai", reason: "本表服务账户示例声明自引用" },
  { rule: "minisign-secret", file: /^scripts\/release-check\.mjs$/, match: "untrusted comment: minisign encrypted secret key", reason: "本表密钥规则声明自引用（规则正则本体，非真实私钥）" },
];

const ASSET_EMAIL_EXT = /\.(png|jpe?g|gif|webp|icns|ico|svg)$/i; // 128x128@2x.png 之类
const BINARY_EXT = /\.(png|jpe?g|gif|webp|icns|ico|zip|gz|tar|wasm|onnx|dmg|exe|icns|woff2?|ttf|otf|mp3|wav|mp4|pdf)$/i;

function checkScan() {
  const lines = [];
  let pass = true;
  const files = gitTrackedFiles();
  const whitelistHits = new Map(); // index -> count
  const violations = [];
  let scanned = 0;

  for (const rel of files) {
    if (BINARY_EXT.test(rel)) continue;
    const abs = path.join(ROOT, rel);
    let buf;
    try { buf = readFileSync(abs); } catch { continue; }
    if (buf.includes(0)) continue; // 二进制
    if (buf.length > 4 * 1024 * 1024) { lines.push(warn(`跳过超大文件 ${rel}（${(buf.length / 1048576).toFixed(1)}MB）`)); continue; }
    scanned++;
    const text = buf.toString("utf8");
    for (const rule of SCAN_RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(text)) !== null) {
        const hit = m[0];
        if (rule.id === "email" && ASSET_EMAIL_EXT.test(hit)) continue; // 文件名结构性排除
        const lineNo = text.slice(0, m.index).split("\n").length;
        const wl = SCAN_WHITELIST.findIndex((w, i) =>
          w.rule === rule.id &&
          (w.file ? w.file.test(rel) : false) &&
          (w.match ? hit.includes(w.match) : true));
        if (wl >= 0) {
          whitelistHits.set(wl, (whitelistHits.get(wl) || 0) + 1);
          continue;
        }
        violations.push({ rel, lineNo, rule, hit });
      }
    }
  }

  lines.push(ok(`扫描 git 跟踪文件 ${scanned} 个（二进制/超大除外），规则 ${SCAN_RULES.length} 类`));
  for (const v of violations.slice(0, 40)) {
    lines.push(bad(`${v.rel}:${v.lineNo} 命中「${v.rule.desc}」：${v.hit.slice(0, 60)}`));
  }
  if (violations.length > 40) lines.push(bad(`……另有 ${violations.length - 40} 处未列出`));
  if (violations.length > 0) pass = false;

  lines.push(`${BOLD}白名单（显式列出，全部为合成 fixture / 公开端点）：${RESET}`);
  SCAN_WHITELIST.forEach((w, i) => {
    const n = whitelistHits.get(i) || 0;
    const scope = `${w.file ?? "*"}${w.match ? ` :: ${w.match}` : ""}`;
    lines.push(`  ${DIM}[${n} 次命中]${RESET} ${w.rule} @ ${scope} —— ${w.reason}`);
    if (n === 0) lines.push(`      ${warn("白名单条目本轮零命中（可能是被扫文件已变更，建议复核清理）")}`);
  });
  record("scan", "④ 隐私/密钥扫描", pass, lines);
}

// ────────────────────────────────────────────────────────────
// ⑤ 依赖许可证扫描
// ────────────────────────────────────────────────────────────
const LICENSE_ALLOW = new Set([
  "MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "CC0-1.0",
  "CC-BY-4.0", "Python-2.0", "BlueOak-1.0.0", "Unlicense", "MIT-0", "Unicode-DFS-2016",
  "Apache-2.0 OR MIT", "MIT OR Apache-2.0", "(MIT OR CC0-1.0)", "MIT OR CC0-1.0",
  "MIT AND Zlib",
]);
function licenseAllowed(lic) {
  if (!lic) return false;
  const norm = String(lic).replace(/[()]/g, "");
  if (LICENSE_ALLOW.has(norm)) return true;
  // 允许由白名单许可证组成的 AND/OR 组合
  if (/^(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|CC0-1\.0)(( OR | AND )(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|CC0-1\.0|CC-BY-4\.0))+$/.test(norm)) return true;
  return false;
}

function checkDeps() {
  const lines = [];
  let pass = true;
  const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
  const pkgs = lock.packages || {};
  const dist = new Map();
  const badLic = [];
  const badResolved = [];
  for (const [name, pkg] of Object.entries(pkgs)) {
    if (!name) continue;
    if (pkg.link === true) continue; // workspace 符号链接条目，无独立元数据
    const lic = pkg.license ?? pkg.licenses;
    const isWorkspace = name.startsWith("packages/") || name.startsWith("node_modules/@penglai/");
    if (lic == null) {
      if (isWorkspace) { badLic.push(`${name}：workspace 包缺 license 字段`); continue; }
      badLic.push(`${name}：缺少 license 元数据`);
      continue;
    }
    dist.set(String(lic), (dist.get(String(lic)) || 0) + 1);
    if (!licenseAllowed(lic)) badLic.push(`${name}：${lic}`);
    if (
      typeof pkg.resolved === "string" &&
      !pkg.resolved.startsWith("https://registry.npmjs.org/") &&
      !name.startsWith("node_modules/@penglai/")
    ) {
      badResolved.push(`${name}：${pkg.resolved}`);
    }
  }

  const REQUIRED_SECURE_VERSIONS = {
    "node_modules/adm-zip": "0.6.0",
    "node_modules/nanoid": "3.3.18",
    "node_modules/postcss": "8.5.26",
    "node_modules/vite": "7.3.6",
  };
  for (const [name, expected] of Object.entries(REQUIRED_SECURE_VERSIONS)) {
    const entry = pkgs[name];
    if (entry?.version !== expected || !entry.integrity) {
      pass = false;
      lines.push(bad(`${name} 必须锁定 ${expected} 且带 integrity（当前 ${entry?.version ?? "missing"}）`));
    } else {
      lines.push(ok(`${name}@${expected} 已锁定，带 integrity`));
    }
  }
  if (badResolved.length > 0) {
    pass = false;
    for (const item of badResolved.slice(0, 20)) lines.push(bad(`非官方 npm 锁源：${item}`));
  } else {
    lines.push(ok("package-lock 远程包全部来自 registry.npmjs.org"));
  }
  const cargoLock = readFileSync(path.join(ROOT, "packages/desktop/src-tauri/Cargo.lock"), "utf8");
  if (/name = "event-listener"\nversion = "5\.4\.1"/.test(cargoLock)) {
    pass = false;
    lines.push(bad("Cargo.lock 仍含受 RUSTSEC-2026-0221 影响的 event-listener 5.4.1"));
  } else if (/name = "event-listener"\nversion = "5\.4\.2"/.test(cargoLock)) {
    lines.push(ok("event-listener 5.4.2（RUSTSEC-2026-0221 修复版）"));
  } else {
    pass = false;
    lines.push(bad("Cargo.lock 未找到预期 event-listener 5.4.2"));
  }

  // Earendil / Pi 内核：package.json 精确 pin + lock 与已安装包均须 MIT
  const PINNED_PI_VERSION = "0.83.0";
  const hostPkg = JSON.parse(readFileSync(path.join(ROOT, "packages/host/package.json"), "utf8"));
  for (const dep of ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai"]) {
    const declared = hostPkg.dependencies?.[dep];
    if (declared !== PINNED_PI_VERSION) {
      pass = false;
      lines.push(bad(`${dep} 未精确 pin ${PINNED_PI_VERSION}（当前声明 ${declared}）`));
    }
    const lockEntry = pkgs[`node_modules/${dep}`];
    if (!lockEntry || lockEntry.license !== "MIT") {
      pass = false;
      lines.push(bad(`${dep} lock 记录许可证非 MIT：${lockEntry?.license}`));
    } else {
      lines.push(ok(`${dep}@${lockEntry.version} —— MIT（lock 记录）`));
    }
    try {
      const installed = JSON.parse(readFileSync(path.join(ROOT, "node_modules", dep, "package.json"), "utf8"));
      if (installed.license !== "MIT") { pass = false; lines.push(bad(`${dep} 已安装包许可证非 MIT`)); }
    } catch {
      lines.push(warn(`${dep} 未在 node_modules 安装（CI 环境下以 lock 为准）`));
    }
  }

  if (badLic.length > 0) {
    pass = false;
    for (const b of badLic.slice(0, 30)) lines.push(bad(`非白名单许可证：${b}`));
  } else {
    lines.push(ok(`全 lock 依赖许可证均在白名单（MIT/Apache-2.0/BSD/ISC/CC0 家族）`));
  }
  const distStr = [...dist.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join("，");
  lines.push(`${DIM}许可证分布：${distStr}${RESET}`);
  record("deps", "⑤ 依赖许可证扫描（Earendil/Pi 必须 MIT）", pass, lines);
}

// ────────────────────────────────────────────────────────────
// ⑥ 无禁推文件混入
// ────────────────────────────────────────────────────────────
const BANNED_PATTERNS = [
  { re: /REARCHITECTURE_0\.4/i, why: "内部重构设计文档" },
  { re: /顶层设计/, why: "内部顶层设计文档" },
  { re: /0\.4\.0设计文档/, why: "内部设计文档目录" },
  { re: /grok_report/i, why: "内部调研报告" },
  { re: /strategy/i, why: "内部策略文档" },
  { re: /ABSORPTION_0\.3/i, why: "内部吸收盘点文档（已并入施工日志）" },
  { re: /(^|\/)AGENTS\.md$/i, why: "本地代理记忆文件" },
  { re: /(^|\/)archive\//i, why: "本地归档目录" },
  { re: /(^|\/)\.env(\.|$)/i, why: "环境变量密钥文件" },
  { re: /(^|\/)mykey\.py(\.|$)/i, why: "0.3 真实密钥文件" },
  { re: /\.(key|pem|p12)$/i, why: "密钥/证书文件" },
  { re: /penglai-release-keys/i, why: "Tauri updater 签名私钥目录（只存在 owner 本机）" },
  { re: /(^|\/)secrets?\//i, why: "密钥目录" },
  { re: /(^|\/)auth\.json$/i, why: "本地认证状态" },
  { re: /penglai-migrate-backup-/i, why: "迁移备份（含密钥）" },
  { re: /restore_commit\.txt/i, why: "本地恢复标记" },
  { re: /run_m3_tests/i, why: "本地测试脚本目录" },
];
/** 合成测试夹具白名单：这些路径形似密钥但实为假数据，必须入库。 */
const FIXTURE_ALLOW = [
  /^packages\/host\/test\/fixtures\/03home\/mykey\.py$/,
];
const DOCS_ALLOW = [
  /^docs\/OWNER_ACCEPTANCE\.md$/,
  /^docs\/DOGFOOD_LOG\.md$/,
  /^docs\/RELEASE_NOTES_0\.4\.0\.md$/,
  /^docs\/RELEASE_PROCESS\.md$/,
  /^docs\/UNINSTALL\.md$/,
  /^docs\/PRIVACY_AND_DATA\.md$/,
  /^docs\/SECURITY_AUDIT_0\.4\.0\.md$/,
  /^docs\/website\//,
];

function checkFiles() {
  const lines = [];
  let pass = true;
  const files = gitTrackedFiles();
  for (const rel of files) {
    // 合成夹具白名单优先：形似密钥但实为假数据，跳过 banned 检查。
    if (FIXTURE_ALLOW.some((a) => a.test(rel))) continue;
    for (const b of BANNED_PATTERNS) {
      if (b.re.test(rel)) { pass = false; lines.push(bad(`禁推文件被跟踪：${rel}（${b.why}）`)); }
    }
    if (rel.startsWith("docs/") && !DOCS_ALLOW.some((a) => a.test(rel))) {
      pass = false;
      lines.push(bad(`未放行的 docs/ 文件被跟踪：${rel}（docs/* 默认忽略，仅白名单可入库）`));
    }
  }
  // CONTRIBUTING 等公开文件不得再引用内部设计文档名
  for (const rel of ["CONTRIBUTING.md", "README.md", "docs/OWNER_ACCEPTANCE.md", "docs/RELEASE_NOTES_0.4.0.md"]) {
    try {
      const text = readFileSync(path.join(ROOT, rel), "utf8");
      const m = text.match(/REARCHITECTURE_0\.4|顶层设计|0\.4\.0设计文档/);
      if (m) { pass = false; lines.push(bad(`${rel} 引用内部设计文档名「${m[0]}」`)); }
    } catch { /* 文件可能尚未创建（RELEASE_NOTES） */ }
  }
  if (pass) lines.push(ok(`跟踪文件 ${files.length} 个，无禁推文件混入；docs/ 仅白名单内文件`));
  record("files", "⑥ 禁推文件检查", pass, lines);
}

// ────────────────────────────────────────────────────────────
// ⑦ 0.3 关系声明存在
// ────────────────────────────────────────────────────────────
function checkStatement() {
  const lines = [];
  let pass = true;
  let readme = "";
  try { readme = readFileSync(path.join(ROOT, "README.md"), "utf8"); }
  catch { record("statement", "⑦ 0.3↔0.4 关系声明", false, [bad("README.md 不存在")]); return; }

  const REQUIRED = [
    { re: /0\.3\.x/, label: "提及 0.3.x 产品线" },
    { re: /v0\.3\.6/, label: "0.3 归档于 v0.3.6 标签" },
    { re: /gh-pages/, label: "声明两分支策略（main + gh-pages）" },
    { re: /Python/i, label: "说明 0.3 是 Python 产品线" },
    { re: /冻结维护|归档|frozen|archiv/i, label: "说明 0.3 冻结/归档" },
    { re: /TypeScript|TS 重写/i, label: "说明 0.4 是 TS 重写" },
    { re: /GenericAgent/, label: "致谢 GenericAgent 基因" },
    { re: /@earendil-works\/pi|Pi 内核|Pi kernel/i, label: "致谢 Pi 内核" },
    { re: /Trae/i, label: "致谢 Trae Agent 调研" },
  ];
  for (const r of REQUIRED) {
    if (r.re.test(readme)) lines.push(ok(`README ${r.label}`));
    else { pass = false; lines.push(bad(`README 缺少：${r.label}`)); }
  }
  const pyCount = gitTrackedFiles().filter((f) => f.endsWith(".py")).length;
  lines.push(`${DIM}仓库内 0.3 Python 存量：${pyCount} 个 .py 跟踪文件（保留为迁移参考，README 已声明关系）${RESET}`);
  record("statement", "⑦ 0.3 Python 存量与 0.4 的关系声明", pass, lines);
}

// ────────────────────────────────────────────────────────────
console.log(`${BOLD}蓬莱 0.4.0 发布门禁报告${RESET}`);
console.log(`仓库：${ROOT}`);
console.log(`时间：${new Date().toISOString()}`);
console.log(`分支：${execFileSync("git", ["branch", "--show-current"], { cwd: ROOT, encoding: "utf8" }).trim()}（本脚本绝不执行 push）`);

if (enabled("tests")) checkTests();
if (enabled("tsc")) checkTsc();
if (enabled("build")) checkBuild();
if (enabled("scan")) checkScan();
if (enabled("deps")) checkDeps();
if (enabled("files")) checkFiles();

// ────────────────────────────────────────────────────────────
// ⑧ schema 交叉校验：protocol == generated rust/json == 无硬编码 1/6 漂移
// ────────────────────────────────────────────────────────────
function checkSchema() {
  const lines = [];
  let pass = true;
  // regenerate freshness
  const sync = run("node", ["scripts/sync-schema-versions.mjs", "--check"]);
  if (sync.code !== 0) {
    pass = false;
    lines.push(bad("schema 生成物过期：node scripts/sync-schema-versions.mjs --check 失败"));
    lines.push(DIM + (sync.out || "").split("\n").slice(-8).join("\n") + RESET);
  } else {
    lines.push(ok("schema 生成物与 protocol 一致"));
  }
  try {
    const gen = JSON.parse(readFileSync(path.join(ROOT, "packages/host/scripts/schema-versions.generated.json"), "utf8"));
    const protocol = readFileSync(path.join(ROOT, "packages/protocol/src/index.ts"), "utf8");
    const rust = readFileSync(path.join(ROOT, "packages/desktop/src-tauri/src/lib.rs"), "utf8");
    const rustGen = readFileSync(path.join(ROOT, "packages/desktop/src-tauri/src/schema_versions.rs"), "utf8");
    const buildRt = readFileSync(path.join(ROOT, "packages/host/scripts/build-runtime.mjs"), "utf8");
    const verifyRt = readFileSync(path.join(ROOT, "packages/host/scripts/verify-runtime.mjs"), "utf8");
    const db = gen.databaseSchemaVersion;
    const proto = gen.protocolSchemaVersion;
    if (!protocol.includes(`DATABASE_SCHEMA_VERSION = ${db}`)) {
      pass = false; lines.push(bad(`protocol 与 generated JSON database=${db} 不一致`));
    } else {
      lines.push(ok(`protocol DATABASE_SCHEMA_VERSION=${db}`));
    }
    if (!rustGen.includes(`DATABASE_SCHEMA_VERSION: u64 = ${db}`)) {
      pass = false; lines.push(bad(`schema_versions.rs database 不是 ${db}`));
    } else {
      lines.push(ok(`Rust schema_versions.rs database=${db}`));
    }
    if (!rust.includes('include!("schema_versions.rs")')) {
      pass = false; lines.push(bad("lib.rs 未 include schema_versions.rs（仍可能硬编码）"));
    } else {
      lines.push(ok("lib.rs include! schema_versions.rs"));
    }
    // The packaging scripts must consume the GENERATED schema source, never a
    // hardcoded version (the old checks matched `databaseSchemaVersion: 1`,
    // which silently stopped firing the day the schema left 1).
    if (!/schemaVersions\.databaseSchemaVersion/.test(buildRt)) {
      pass = false; lines.push(bad("build-runtime.mjs 未引用 generated schemaVersions（可能硬编码）"));
    } else {
      lines.push(ok("build-runtime 使用 generated schema versions"));
    }
    if (!/schemaVersions\.databaseSchemaVersion/.test(verifyRt)) {
      pass = false; lines.push(bad("verify-runtime.mjs 未引用 generated schemaVersions（可能硬编码）"));
    } else {
      lines.push(ok("verify-runtime 使用 generated schema versions"));
    }
    lines.push(ok(`契约：protocolSchema=${proto} databaseSchema=${db}`));
  } catch (e) {
    pass = false;
    lines.push(bad(`读取 schema 文件失败：${e.message || e}`));
  }
  record("schema", "⑧ schema 单一真相源交叉校验", pass, lines);
}


if (enabled("statement")) checkStatement();
if (enabled("schema")) checkSchema();


const failed = results.filter((r) => !r.pass);
console.log(`\n${BOLD}════════ 结论 ════════${RESET}`);
if (failed.length === 0) {
  console.log(`${GREEN}${BOLD}可推送${RESET} —— ${results.length} 项检查全部通过。`);
  process.exit(0);
} else {
  console.log(`${RED}${BOLD}不可推送${RESET} —— ${failed.length} 项未通过：${failed.map((f) => f.title).join("；")}`);
  process.exit(1);
}
