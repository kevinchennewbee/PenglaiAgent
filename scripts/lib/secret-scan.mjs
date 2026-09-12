import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "./repo.mjs";

export const FIXTURE_MARKER = /penglai-test-fixture|penglai-test-other-fixture|\[redacted\]/;

export const SECRET_RULES = Object.freeze([
  {
    id: "private-key",
    category: "key-material",
    re: /BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY/,
  },
  {
    id: "weixin-token",
    category: "token",
    re: /weixin[^.\n]{0,40}token\s*[:=]\s*\S+/i,
  },
  {
    id: "bot-token",
    category: "token",
    re: /bot_token\s*[:=]\s*(?:["'][^"']{6,}["']|[A-Za-z0-9._~+/:=-]{8,})/i,
  },
  {
    id: "api-key-sk",
    category: "api-key",
    re: /\bsk-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: "github-token",
    category: "token",
    re: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[oprsu]_[A-Za-z0-9]{20,})\b/,
  },
  {
    id: "slack-token",
    category: "token",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  },
  {
    id: "telegram-token",
    category: "token",
    re: /\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: "colon-secret",
    category: "colon-form",
    re: /(?:API_KEY|CLIENT_SECRET|APP_SECRET|SECRET|PASSWORD|ACCESS_TOKEN|REFRESH_TOKEN)\s*:\s*["']?[A-Za-z0-9._~+/:=-]{8,}/,
  },
  {
    id: "json-secret",
    category: "json-form",
    re: /"(?:apiKey|api_key|clientSecret|client_secret|appSecret|app_secret|accessToken|access_token|refreshToken|refresh_token|botToken|bot_token|password)"\s*:\s*"[^"]{8,}"/i,
  },
  {
    id: "named-secret",
    category: "named-form",
    re: /(?:API_KEY|CLIENT_SECRET|APP_SECRET|ACCESS_TOKEN|REFRESH_TOKEN|PASSWORD)\s*=\s*(?:["'][^"']{6,}["']|[A-Za-z0-9._~+/:=-]{8,})/,
  },
  {
    id: "header-auth",
    category: "header",
    re: /Authorization\s*[:=]\s*(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/i,
  },
  {
    id: "voice-ref",
    category: "voice-reference",
    re: /local-voices\/[A-Za-z0-9._-]+\.(wav|pcm)/i,
  },
  {
    id: "transcript",
    category: "transcript-body",
    re: /transcript["']?\s*[:=]\s*["'][^"']{12,}/i,
  },
  {
    id: "granted-path",
    category: "account-path",
    re: /grantedPath["']?\s*[:=]\s*["']\/(?:Users|home)\//,
  },
]);

// Owner identity leak rules. Absolute home/volume paths and personal webmail
// addresses in tracked text are owner data, never product data. This is a
// fail-closed gate: any concrete path segment outside the synthetic vocabulary
// below is a hit, so a new real username is caught without enumerating it.
export const SYNTHETIC_PATH_SEGMENTS = Object.freeze([
  "owner",
  "example",
  "alice",
  "bob",
  "carol",
  "dave",
  "jane",
  "john",
  "user",
  "test",
  "sample",
  "demo",
  "me",
  "you",
  "private",
  "secret",
  "test-owner",
  "random-builder",
  "cloudtest",
  "runner",
  "build",
  "srv",
  "drive",
  "private-owner",
  "private-owner-drive",
  // DMG volume label used by scripts/build-local-dmg.mjs, not a real path.
  "penglai",
]);

export const PERSONAL_EMAIL_DOMAINS = Object.freeze([
  "qq.com",
  "vip.qq.com",
  "foxmail.com",
  "163.com",
  "126.com",
  "yeah.net",
  "sina.com",
  "sina.cn",
  "sohu.com",
  "139.com",
  "189.cn",
  "tom.com",
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
]);

const UNIX_OWNER_PATH = /(?<![A-Za-z0-9:])\/(?:Users|Volumes|home)\/([A-Za-z0-9][A-Za-z0-9._-]*)/g;
const WINDOWS_OWNER_PATH = /C:[\\/]+Users[\\/]+([A-Za-z0-9][A-Za-z0-9._-]*)/gi;
const EMAIL_ADDRESS = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

export function scanIdentityText(rel, text) {
  const hits = [];
  const file = rel.replaceAll("\\", "/");
  if (isImmutablePublicationRecord(file)) return hits;
  const lines = String(text).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (FIXTURE_MARKER.test(line)) continue;
    if (lineLooksLikeDetector(line)) continue;
    let ownerPathFound = false;
    for (const re of [UNIX_OWNER_PATH, WINDOWS_OWNER_PATH]) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(line)) !== null) {
        const segment = (match[1] ?? "").toLowerCase();
        if (segment && !SYNTHETIC_PATH_SEGMENTS.includes(segment)) {
          hits.push({ rule: "owner-absolute-path", category: "owner-path", file, line: index + 1 });
          ownerPathFound = true;
          break;
        }
      }
      if (ownerPathFound) break;
    }
    EMAIL_ADDRESS.lastIndex = 0;
    let email;
    while ((email = EMAIL_ADDRESS.exec(line)) !== null) {
      if (PERSONAL_EMAIL_DOMAINS.includes((email[1] ?? "").toLowerCase())) {
        hits.push({ rule: "personal-email", category: "personal-email", file, line: index + 1 });
        break;
      }
    }
  }
  return hits;
}

// Published immutable release records are frozen by policy and enforced by
// scripts/verify-release-adaptation.mjs, which fails any later release that
// rewrites them. An owner path already frozen inside one of these records can
// therefore not be edited out without breaking the release gate. The identity
// rule skips exactly these paths (a known, accepted condition) instead of
// demanding an edit that policy forbids; every other tracked path stays
// fail-closed.
const IMMUTABLE_PUBLICATION_RECORD = [
  /^docs\/0\.5\.(?:8|9|10)\//,
  /^docs\/0\.6\.0\//,
  /^docs\/(?:PUBLICATION|PUBLICATION_MANIFEST|RELEASE_NOTES)_0\.5\.(?:8|10|11)\.md$/,
  /^docs\/(?:PUBLICATION|PUBLICATION_MANIFEST|RELEASE_NOTES)_0\.6\.0\.md$/,
];

export function isImmutablePublicationRecord(rel) {
  const file = rel.replaceAll("\\", "/");
  return IMMUTABLE_PUBLICATION_RECORD.some((re) => re.test(file));
}

const SKIP_PATH =
  /^(?:node_modules\/|.*\/node_modules\/|dist\/|.*\/dist\/|\.git\/|pnpm-lock\.yaml$|package-lock\.json$|.*\.(?:png|jpg|jpeg|webp|gif|icns|ico|woff2?|dylib|dll|node|wasm|tgz|tar\.gz|zip)$|.*\.so(?:\.\d+)*$|(?:.*\/)?mnemon(?:\.exe)?$)/;

export function isSkippedScanPath(rel) {
  return SKIP_PATH.test(rel.replaceAll("\\", "/"));
}

export function lineLooksLikeDetector(line) {
  let s = String(line).trim();
  if (s.startsWith("re:")) s = s.slice(3).trimStart();
  else if (s.startsWith("if")) {
    s = s.slice(2).trimStart();
    if (s.startsWith("(")) s = s.slice(1).trimStart();
  }
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/*")) return false;
  let i = 1;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "/") break;
    if (ch === "\n") return false;
    i += 1;
  }
  if (i >= s.length || s[i] !== "/") return false;
  i += 1;
  while (i < s.length && "gimsuy".includes(s[i] ?? "")) i += 1;
  const rest = s.slice(i).trim();
  if (rest === "" || rest === "," || rest === ";") return true;
  if (!rest.startsWith(".test(")) return false;
  const close = rest.indexOf(")");
  if (close < 0) return false;
  const after = rest.slice(close + 1).replaceAll(")", "").trim();
  return after === "" || after === "{";
}

function hasConcreteApiKey(line) {
  return /\bsk-[A-Za-z0-9_-]{20,}\b/.test(line);
}

export function scanText(rel, text) {
  const hits = [];
  const lines = String(text).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const rule of SECRET_RULES) {
      if (!rule.re.test(line)) continue;
      rule.re.lastIndex = 0;
      if (FIXTURE_MARKER.test(line)) continue;
      if (lineLooksLikeDetector(line) && !hasConcreteApiKey(line)) continue;
      hits.push({
        rule: rule.id,
        category: rule.category,
        file: rel.replaceAll("\\", "/"),
        line: index + 1,
      });
    }
  }
  return hits;
}

export function formatSecretHits(hits) {
  return hits.map((hit) => `${hit.file}:${hit.line} rule=${hit.rule} category=${hit.category}`).join("\n");
}

export function listScanTargets(root) {
  const tracked = git(["ls-files"], { cwd: root }).split("\n").filter(Boolean);
  const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"], { cwd: root })
    .split("\n")
    .filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard"], { cwd: root })
    .split("\n")
    .filter(Boolean);
  return [...new Set([...tracked, ...staged, ...untracked])].filter((rel) => !isSkippedScanPath(rel));
}

export function scanRepository(root) {
  const hits = [];
  for (const rel of listScanTargets(root)) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    hits.push(...scanText(rel, text));
    hits.push(...scanIdentityText(rel, text));
  }
  return hits;
}
