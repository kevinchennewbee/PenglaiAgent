import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PenglaiError } from "@penglai/contracts";

const FORBIDDEN = [
  { re: /\/penglai\/usable-fixture/, reason: "usable-fixture" },
  { re: /penglai-loopback/, reason: "penglai-loopback" },
  { re: /PENGLAI_INSTALLED_PROBE/, reason: "installed-probe" },
  { re: /PENGLAI_LOOPBACK_LLM/, reason: "loopback-env" },
  { re: /proveCausalRoute/, reason: "proveCausalRoute" },
  { re: /rollbackFixture/, reason: "alpha-rollback-fixture" },
  { re: /penglai-plugin-reference-0\.2\.0-alpha/, reason: "alpha-rollback-fixture" },
  { re: /PENGLAI_IM_START_WORKERS/, reason: "worker env gate" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, reason: "private key" },
  { re: /sk-[A-Za-z0-9]{16,}/, reason: "api key" },
  { re: /\/Users\/[A-Za-z0-9._-]+\//, reason: "owner path" },
  { re: /\/Volumes\/KevinSSD/, reason: "owner volume" },
  { re: /transcript["']?\s*[:=]\s*["'][^"']{12,}/i, reason: "transcript body" },
  { re: /local-voices\/[A-Za-z0-9._-]+\.(wav|pcm|onnx)/i, reason: "voice reference" },
  { re: /grantedPath["']?\s*[:=]\s*["']\/(?:Users|home)\//, reason: "context grant path" },
  { re: /memoryCandidate["']?\s*[:=]\s*["'][^"']{12,}/i, reason: "memory candidate body" },
  { re: /companionAudit["']?\s*[:=]\s*["'][^"']{8,}/i, reason: "companion audit body" },
];

const FORBIDDEN_NAMES = [
  "evidence/",
  ".git/",
  "assertions.jsonl",
  "id_ed25519",
  ".pem",
  "penglai-loopback",
  "loopback-llm",
  "usable-fixture",
];

export function scanBundleText(rel: string, text: string): string[] {
  const hits: string[] = [];
  for (const name of FORBIDDEN_NAMES) {
    if (rel.includes(name)) hits.push(`${rel}:${name}`);
  }
  for (const rule of FORBIDDEN) {
    if (rule.re.test(text)) hits.push(`${rel}:${rule.reason}`);
  }
  return hits;
}

const BINARY_EXTENSIONS = /\.(?:node|dylib|dll|so(?:\.\d+)*|exe|wasm)$/i;

function isBinaryArtifact(rel: string, buf: Buffer): boolean {
  if (BINARY_EXTENSIONS.test(rel)) return true;
  return buf.subarray(0, Math.min(buf.length, 8192)).includes(0);
}

export function scanBundleBytes(rel: string, buf: Buffer): string[] {
  if (!isBinaryArtifact(rel, buf)) return scanBundleText(rel, buf.toString("utf8"));
  const text = buf.toString("latin1");
  const pinnedUpstreamBuilderPrefixes = [
    ["", "Users", "cloudtest", "vss", "_work", ""].join("/"),
    ["", "Users", "runner", "work", "1", ""].join("/"),
    ["", "Users", "runner", "work", "_temp", ""].join("/"),
  ];
  const textWithoutPinnedUpstreamBuilders = pinnedUpstreamBuilderPrefixes.reduce(
    (sanitized, prefix) => sanitized.replaceAll(prefix, "/pinned-upstream-builder/"),
    text,
  );
  const hits: string[] = [];
  for (const name of FORBIDDEN_NAMES) {
    if (rel.includes(name)) hits.push(`${rel}:${name}`);
  }
  for (const rule of FORBIDDEN) {
    // Pinned ONNX Runtime binaries legitimately retain Microsoft's Azure and
    // GitHub Actions macOS build roots in assertion strings. No other owner
    // path is exempted, and the current packager home is checked separately.
    if (rule.re.test(textWithoutPinnedUpstreamBuilders)) {
      hits.push(`${rel}:${rule.reason}`);
    }
  }
  const currentHome = homedir().replaceAll("\\", "/").replace(/\/+$/, "");
  if (currentHome && currentHome !== "/" && text.includes(`${currentHome}/`)) {
    hits.push(`${rel}:local packager path`);
  }
  return hits;
}

export function assertProductionBundleClean(files: Record<string, string>): void {
  const hits: string[] = [];
  for (const [rel, text] of Object.entries(files)) {
    hits.push(...scanBundleText(rel, text));
  }
  if (hits.length) {
    throw new PenglaiError("SECURITY_POLICY", `production bundle forbidden ${hits.join(",")}`);
  }
}

function walkFiles(root: string, rel = ""): string[] {
  const dir = rel ? join(root, rel) : root;
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const child = rel ? `${rel}/${name}` : name;
    const st = statSync(join(root, child));
    if (st.isDirectory()) out.push(...walkFiles(root, child));
    else out.push(child);
  }
  return out;
}

export function scanUnpackedTree(root: string): string[] {
  const hits: string[] = [];
  for (const rel of walkFiles(root)) {
    const abs = join(root, rel);
    const buf = readFileSync(abs);
    hits.push(...scanBundleBytes(rel, buf));
  }
  return hits;
}

export function unpackArchive(archivePath: string, dest: string): void {
  if (!existsSync(archivePath)) {
    throw new PenglaiError("INVALID_INPUT", `archive missing ${archivePath}`);
  }
  if (/\.(tgz|tar\.gz)$/.test(archivePath)) {
    execFileSync("tar", ["-xzf", archivePath, "-C", dest]);
    return;
  }
  if (archivePath.endsWith(".tar")) {
    execFileSync("tar", ["-xf", archivePath, "-C", dest]);
    return;
  }
  if (archivePath.endsWith(".asar")) {
    try {
      execFileSync("npx", ["--yes", "asar", "extract", archivePath, dest], { stdio: "ignore" });
      return;
    } catch {
      const raw = readFileSync(archivePath);
      hitsOrThrowAsar(raw);
      return;
    }
  }
  if (archivePath.endsWith(".dmg") && process.platform === "darwin") {
    const info = execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-plist", archivePath], { encoding: "utf8" });
    const mount = /<string>(\/Volumes\/[^<]+)<\/string>/.exec(info)?.[1];
    if (!mount) throw new PenglaiError("INVALID_INPUT", "dmg mount path missing");
    try {
      execFileSync("ditto", [mount, dest]);
    } finally {
      execFileSync("hdiutil", ["detach", mount, "-quiet"]);
    }
    return;
  }
  const raw = readFileSync(archivePath);
  const hits = scanBundleBytes(archivePath, raw);
  if (hits.length) throw new PenglaiError("SECURITY_POLICY", `production bundle forbidden ${hits.join(",")}`);
}

function hitsOrThrowAsar(raw: Buffer): void {
  const hits = scanBundleText("app.asar", raw.toString("utf8"));
  if (hits.length) throw new PenglaiError("SECURITY_POLICY", `production bundle forbidden ${hits.join(",")}`);
}

export function assertPackedArtifactClean(archivePath: string): void {
  const dest = mkdtempSync(join(tmpdir(), "penglai-unpack-scan-"));
  unpackArchive(archivePath, dest);
  if (!existsSync(dest) || readdirSync(dest).length === 0) {
    const raw = readFileSync(archivePath);
    const hits = scanBundleBytes(archivePath, raw);
    if (hits.length) throw new PenglaiError("SECURITY_POLICY", `production bundle forbidden ${hits.join(",")}`);
    return;
  }
  const hits = scanUnpackedTree(dest);
  if (hits.length) {
    throw new PenglaiError("SECURITY_POLICY", `production bundle forbidden ${hits.join(",")}`);
  }
}
