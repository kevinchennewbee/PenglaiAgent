import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { PenglaiError, readExactRegularFile } from "@penglai/contracts";
import { assertGrant, type ContextGrant } from "./service.js";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_FILES_PER_SCAN = 400;
export const MAX_TEXT_BYTES = 256 * 1024;
export const TEXT_EXTS = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".html", ".htm", ".xml", ".yml", ".yaml", ".log"]);

export interface IngestedDoc {
  path: string;
  digest: string;
  body: string;
  bytes: number;
}

export interface IngestReport {
  scanned: number;
  indexed: number;
  failed: number;
  skipped: number;
  docs: IngestedDoc[];
}

export function fileDigest(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function isUnderRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.includes("\0"));
}

export function extractText(path: string, buf: Buffer): string {
  const ext = extname(path).toLowerCase();
  if (TEXT_EXTS.has(ext)) {
    return buf.toString("utf8").slice(0, MAX_TEXT_BYTES);
  }
  throw new PenglaiError("INVALID_INPUT", `unsupported context type ${ext || "unknown"}`);
}

export function walkGrant(grant: ContextGrant): IngestReport {
  assertGrant(grant);
  const root = realpathSync(grant.realPath);
  if (root !== grant.realPath) throw new PenglaiError("SECURITY_POLICY", "context grant must be realpath");
  const st = statSync(root);
  const report: IngestReport = { scanned: 0, indexed: 0, failed: 0, skipped: 0, docs: [] };
  const files: string[] = [];
  if (st.isFile()) files.push(root);
  else collectFiles(root, root, files);
  for (const file of files) {
    report.scanned += 1;
    if (report.indexed >= MAX_FILES_PER_SCAN) {
      report.skipped += 1;
      continue;
    }
    try {
      // Re-verify against the resolved tree at read time: a file collected as
      // a real path may have been swapped for a symlink (or Windows junction)
      // pointing outside the grant root in the meantime.
      const real = realpathSync(file);
      if (!isUnderRoot(root, real)) {
        report.failed += 1;
        continue;
      }
      const ext = extname(file).toLowerCase();
      if (!TEXT_EXTS.has(ext)) {
        report.skipped += 1;
        continue;
      }
      let buf: Buffer;
      try {
        buf = readExactRegularFile(file, MAX_FILE_BYTES);
      } catch {
        report.skipped += 1;
        continue;
      }
      const body = extractText(file, buf);
      if (!body.trim()) {
        report.skipped += 1;
        continue;
      }
      report.docs.push({ path: file, digest: fileDigest(buf), body, bytes: buf.length });
      report.indexed += 1;
    } catch {
      report.failed += 1;
    }
  }
  return report;
}

function collectFiles(root: string, dir: string, out: string[]): void {
  if (out.length >= MAX_FILES_PER_SCAN * 2) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const next = resolve(dir, entry.name);
    if (!isUnderRoot(root, next)) continue;
    let real: string;
    let lst;
    try {
      // A symlink or Windows junction resolves to its target; refuse anything
      // whose resolved location escapes the grant root. This closes the
      // "junction appears as a directory" escape and the TOCTOU where a
      // directory entry is swapped for a link after readdir.
      real = realpathSync(next);
      lst = lstatSync(next);
    } catch {
      continue; // broken symlink / unreadable entry
    }
    if (!isUnderRoot(root, real)) continue;
    if (lst.isSymbolicLink()) continue;
    if (lst.isDirectory()) collectFiles(root, next, out);
    else if (lst.isFile()) out.push(next);
  }
}

export function assertExistingGrantRoot(path: string): string {
  if (!existsSync(path)) throw new PenglaiError("INVALID_INPUT", "context grant path missing");
  return realpathSync(path);
}

export function joinUnder(root: string, name: string): string {
  return join(root, name);
}
