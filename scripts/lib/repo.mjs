import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", cwd: ROOT, ...opts }).trim();
}

export function gitState() {
  const head = git(["rev-parse", "HEAD"]);
  const originMain = git(["rev-parse", "origin/main"]);
  const dirty = git(["status", "--porcelain"]).length > 0;
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  return { head, originMain, dirty, branch };
}

// A path is "docs-only" when it is a state/doc change that must not invalidate
// an already-built artifact. The `$` anchor previously applied to the whole
// alternation, so `docs/ACCEPTANCE.md` and `docs/adr/*.md` never matched; only
// the literal string `docs/` did. Prefix-match the docs tree instead.
const DOC_ONLY_PATH = /^(STATE\.md|docs\/.*|AGENTS\.md|PRODUCT_CONSTITUTION\.md)$/;

export function isDocsOnlyPath(name) {
  return DOC_ONLY_PATH.test(String(name ?? ""));
}

export function isDocsOnlyRange(fromSha, toSha) {
  if (!fromSha || !toSha) return false;
  if (fromSha === toSha) return true;
  try {
    const mergeBase = git(["merge-base", fromSha, toSha]);
    if (mergeBase !== fromSha) return false;
    const names = git(["diff", "--name-only", `${fromSha}..${toSha}`])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!names.length) return true;
    return names.every((name) => isDocsOnlyPath(name));
  } catch {
    return false;
  }
}

export function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
}

export function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

export function mustExist(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`missing ${rel}`);
  return p;
}
