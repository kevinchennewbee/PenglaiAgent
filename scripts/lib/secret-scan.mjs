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
    re: /bot_token\s*[:=]\s*(?:["'][^"']{6,}["']|[A-Za-z0-9._~+/-]{8,})/i,
  },
  {
    id: "api-key-sk",
    category: "api-key",
    re: /\bsk-[A-Za-z0-9]{20,}/,
  },
  {
    id: "colon-secret",
    category: "colon-form",
    re: /(?:API_KEY|SECRET|PASSWORD|ACCESS_TOKEN)\s*:\s*["']?[A-Za-z0-9._+-]{10,}/,
  },
  {
    id: "json-secret",
    category: "json-form",
    re: /"(?:apiKey|api_key|client_secret|access_token|password)"\s*:\s*"[^"]{8,}"/i,
  },
  {
    id: "header-auth",
    category: "header",
    re: /Authorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
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

const SKIP_PATH =
  /^(?:node_modules\/|.*\/node_modules\/|dist\/|.*\/dist\/|\.git\/|pnpm-lock\.yaml$|package-lock\.json$|.*\.(?:png|jpg|jpeg|webp|gif|icns|ico|woff2?|dylib|node|wasm|tgz|zip)$)/;

const DETECTOR_LINE = /\/.+\/[gimsuy]*|\.test\(|\.includes\(|lock\.includes\(|\.replace\(|INLINE_SECRET|FORBIDDEN/;

export function isSkippedScanPath(rel) {
  return SKIP_PATH.test(rel.replaceAll("\\", "/"));
}

export function lineLooksLikeDetector(line) {
  return DETECTOR_LINE.test(line);
}

function hasConcreteApiKey(line) {
  return /\bsk-[A-Za-z0-9]{24,}/.test(line);
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
  }
  return hits;
}
