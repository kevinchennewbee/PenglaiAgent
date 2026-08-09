/**
 * Jail-aware path completion for composer @ mentions (Host SSOT root).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface FileCompleteHit {
  path: string;
  name: string;
  isDir: boolean;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Complete file paths under root.
 * query may be "src/comp" or "src/comp/" — returns children / matches.
 */
export function completeFiles(input: {
  rootPath: string;
  query?: string;
  limit?: number;
}): FileCompleteHit[] {
  const unresolvedRoot = path.resolve(input.rootPath);
  if (!fs.existsSync(unresolvedRoot) || !fs.statSync(unresolvedRoot).isDirectory()) return [];
  const root = fs.realpathSync(unresolvedRoot);
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 80);
  const q = (input.query ?? "").replace(/\\/g, "/");
  const hasSlash = q.includes("/");
  const dirPart = hasSlash ? q.slice(0, q.lastIndexOf("/")) : "";
  const basePart = hasSlash ? q.slice(q.lastIndexOf("/") + 1) : q;
  const dirAbs = path.resolve(root, dirPart || ".");
  if (!isInsideRoot(root, dirAbs) || !fs.existsSync(dirAbs)) return [];
  let realDir: string;
  try {
    realDir = fs.realpathSync(dirAbs);
  } catch {
    return [];
  }
  if (!isInsideRoot(root, realDir)) return [];

  let names: string[] = [];
  try {
    names = fs.readdirSync(realDir);
  } catch {
    return [];
  }
  const lower = basePart.toLowerCase();
  const hits: FileCompleteHit[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    if (lower && !name.toLowerCase().startsWith(lower) && !name.toLowerCase().includes(lower)) {
      continue;
    }
    const abs = path.join(realDir, name);
    let isDir = false;
    try {
      const stat = fs.lstatSync(abs);
      if (stat.isSymbolicLink()) continue;
      const real = fs.realpathSync(abs);
      if (!isInsideRoot(root, real)) continue;
      isDir = stat.isDirectory();
    } catch {
      continue;
    }
    const rel = path.relative(root, abs).split(path.sep).join("/");
    hits.push({ path: rel + (isDir ? "/" : ""), name, isDir });
    if (hits.length >= limit) break;
  }
  hits.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.path.localeCompare(b.path));
  return hits;
}
