import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";
import { PenglaiError } from "@penglai/contracts";
import { assertGrant, type ContextGrant } from "./service.js";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_FILES_PER_SCAN = 400;
export const MAX_TEXT_BYTES = 256 * 1024;
export const TEXT_EXTS = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".html", ".htm", ".xml", ".yml", ".yaml", ".log"]);
export const OFFICE_EXTS = new Set([".docx", ".xlsx", ".pptx"]);
export const PDF_EXTS = new Set([".pdf"]);

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
  if (PDF_EXTS.has(ext)) return extractPdfText(buf).slice(0, MAX_TEXT_BYTES);
  if (OFFICE_EXTS.has(ext)) return extractOfficeText(buf, ext).slice(0, MAX_TEXT_BYTES);
  throw new PenglaiError("INVALID_INPUT", `unsupported context type ${ext || "unknown"}`);
}

function extractPdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < raw.length && chunks.length < 128) {
    const marker = raw.indexOf("stream", cursor);
    if (marker < 0) break;
    const afterMarker = marker + "stream".length;
    const dataStart = raw.startsWith("\r\n", afterMarker)
      ? afterMarker + 2
      : raw.startsWith("\n", afterMarker)
        ? afterMarker + 1
        : -1;
    if (dataStart < 0) {
      cursor = afterMarker;
      continue;
    }
    const endMarker = raw.indexOf("endstream", dataStart);
    if (endMarker < 0) break;
    let dataEnd = endMarker;
    if (dataEnd > dataStart && raw[dataEnd - 1] === "\n") dataEnd -= 1;
    if (dataEnd > dataStart && raw[dataEnd - 1] === "\r") dataEnd -= 1;
    const payload = Buffer.from(raw.slice(dataStart, dataEnd), "latin1");
    cursor = endMarker + "endstream".length;
    let decoded: Buffer = payload;
    try {
      decoded = Buffer.from(inflateSync(payload));
    } catch {
      try {
        decoded = Buffer.from(inflateRawSync(payload));
      } catch {
        decoded = payload;
      }
    }
    const text = decoded.toString("utf8");
    const literals = [...text.matchAll(/\(([^()\\]{2,})\)/g)].map((m) => m[1] ?? "");
    if (literals.length) chunks.push(literals.join(" "));
    else if (/[\p{L}\p{N}]/u.test(text)) chunks.push(text.replace(/[^\p{L}\p{N}\s.,;:!?-]/gu, " "));
  }
  const fallback = [...raw.matchAll(/\(([^()\\]{3,})\)/g)].map((m) => m[1] ?? "").join(" ");
  return (chunks.join(" ") || fallback).replace(/\s+/g, " ").trim();
}

function extractOfficeText(buf: Buffer, ext: string): string {
  const wanted =
    ext === ".docx"
      ? ["word/document.xml"]
      : ext === ".xlsx"
        ? ["xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"]
        : ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"];
  const files = readZipTexts(buf, wanted);
  return stripXml(Object.values(files).join(" "));
}

function stripXml(xml: string): string {
  const entities: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"' };
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot);/g, (_match, entity: string) => entities[entity] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function readZipTexts(buf: Buffer, names: readonly string[]): Record<string, string> {
  const eocd = buf.lastIndexOf(Buffer.from("PK\x05\x06"));
  if (eocd < 0) throw new PenglaiError("INVALID_INPUT", "office archive missing central directory");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count && offset + 46 <= buf.length; i += 1) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOff = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    offset += 46 + nameLen + extraLen + commentLen;
    if (!names.includes(name)) continue;
    if (buf.readUInt32LE(localOff) !== 0x04034b50) continue;
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtra = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtra;
    const compressed = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? compressed : inflateRawSync(compressed);
    out[name] = data.toString("utf8");
  }
  return out;
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
      const info = lstatSync(file);
      if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_FILE_BYTES) {
        report.skipped += 1;
        continue;
      }
      const ext = extname(file).toLowerCase();
      if (!TEXT_EXTS.has(ext) && !OFFICE_EXTS.has(ext) && !PDF_EXTS.has(ext)) {
        report.skipped += 1;
        continue;
      }
      const buf = readFileSync(file);
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
