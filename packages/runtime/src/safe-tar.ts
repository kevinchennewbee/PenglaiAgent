import { gunzipSync } from "node:zlib";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { PenglaiError } from "@penglai/contracts";

export interface SafeTarEntry {
  path: string;
  kind: "file" | "directory";
  mode: number;
  data: Buffer;
}

const BLOCK = 512;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 100_000;

function fieldText(block: Buffer, start: number, length: number): string {
  const bytes = block.subarray(start, start + length);
  const nul = bytes.indexOf(0);
  return bytes.subarray(0, nul < 0 ? bytes.length : nul).toString("utf8");
}

function octal(block: Buffer, start: number, length: number): number {
  const text = fieldText(block, start, length).trim().replace(/\0/g, "");
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) {
    throw new PenglaiError("SECURITY_POLICY", "tar numeric field is not octal");
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PenglaiError("SECURITY_POLICY", "tar numeric field overflow");
  }
  return value;
}

function checksum(block: Buffer): number {
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : (block[index] ?? 0);
  }
  return sum;
}

function parsePax(body: Buffer): Record<string, string> {
  const values: Record<string, string> = {};
  let offset = 0;
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    if (space < 0) throw new PenglaiError("SECURITY_POLICY", "malformed pax length");
    const length = Number(body.subarray(offset, space).toString("ascii"));
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > body.length) {
      throw new PenglaiError("SECURITY_POLICY", "malformed pax record");
    }
    const record = body.subarray(space + 1, offset + length - 1).toString("utf8");
    const split = record.indexOf("=");
    if (split <= 0) throw new PenglaiError("SECURITY_POLICY", "malformed pax value");
    values[record.slice(0, split)] = record.slice(split + 1);
    offset += length;
  }
  return values;
}

function safeArchivePath(input: string): string | undefined {
  const raw = input.replace(/^\.\//, "").replace(/\/$/, "");
  if (!raw || raw === ".") return undefined;
  if (
    raw.includes("\0") ||
    raw.includes("\\") ||
    isAbsolute(raw) ||
    /^[A-Za-z]:/.test(raw)
  ) {
    throw new PenglaiError("SECURITY_POLICY", `unsafe archive path ${input}`);
  }
  const normalized = posix.normalize(raw);
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    throw new PenglaiError("SECURITY_POLICY", `archive path escaped ${input}`);
  }
  return normalized;
}

export function inspectTarGz(bytes: Buffer): SafeTarEntry[] {
  const tar = gunzipSync(bytes, { maxOutputLength: MAX_ARCHIVE_BYTES });
  const entries: SafeTarEntry[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let pendingPax: Record<string, string> = {};
  let globalPax: Record<string, string> = {};
  let longPath: string | undefined;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    if (octal(header, 148, 8) !== checksum(header)) {
      throw new PenglaiError("SECURITY_POLICY", "tar header checksum mismatch");
    }
    const size = octal(header, 124, 12);
    const mode = octal(header, 100, 8);
    const bodyStart = offset + BLOCK;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) {
      throw new PenglaiError("SECURITY_POLICY", "truncated tar entry");
    }
    const body = tar.subarray(bodyStart, bodyEnd);
    const type = String.fromCharCode(header[156] ?? 0);
    const prefix = fieldText(header, 345, 155);
    const headerName = fieldText(header, 0, 100);
    const headerPath = prefix ? `${prefix}/${headerName}` : headerName;
    if (type === "x") {
      pendingPax = parsePax(body);
    } else if (type === "g") {
      globalPax = { ...globalPax, ...parsePax(body) };
    } else if (type === "L") {
      const nul = body.indexOf(0);
      longPath = body.subarray(0, nul < 0 ? body.length : nul).toString("utf8");
    } else {
      const path = safeArchivePath(
        pendingPax.path ?? globalPax.path ?? longPath ?? headerPath,
      );
      if (path) {
        if (seen.has(path)) {
          throw new PenglaiError("SECURITY_POLICY", `duplicate archive path ${path}`);
        }
        seen.add(path);
        if (type === "\0" || type === "0") {
          entries.push({ path, kind: "file", mode, data: Buffer.from(body) });
        } else if (type === "5") {
          entries.push({ path, kind: "directory", mode, data: Buffer.alloc(0) });
        } else {
          throw new PenglaiError(
            "SECURITY_POLICY",
            `archive entry type ${JSON.stringify(type)} is forbidden`,
          );
        }
      }
      pendingPax = {};
      longPath = undefined;
      if (entries.length > MAX_ENTRIES) {
        throw new PenglaiError("SECURITY_POLICY", "archive entry limit exceeded");
      }
    }
    offset = bodyStart + Math.ceil(size / BLOCK) * BLOCK;
  }
  if (!entries.length) throw new PenglaiError("STORE_CORRUPT", "empty tar archive");
  return entries;
}

function assertDirectoryChain(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new PenglaiError("SECURITY_POLICY", "archive extraction escaped root");
  }
  let cursor = root;
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new PenglaiError("SECURITY_POLICY", "archive extraction met symlink");
    }
  }
}

export function extractTarGz(bytes: Buffer, destination: string): SafeTarEntry[] {
  const root = resolve(destination);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (lstatSync(root).isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "archive destination is symlink");
  }
  const canonicalRoot = realpathSync(root);
  const entries = inspectTarGz(bytes);
  for (const entry of entries.filter((value) => value.kind === "directory")) {
    const target = resolve(canonicalRoot, ...entry.path.split("/"));
    assertDirectoryChain(canonicalRoot, dirname(target));
    mkdirSync(target, { recursive: true, mode: 0o700 });
    assertDirectoryChain(canonicalRoot, target);
  }
  for (const entry of entries.filter((value) => value.kind === "file")) {
    const target = resolve(canonicalRoot, ...entry.path.split("/"));
    assertDirectoryChain(canonicalRoot, dirname(target));
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    assertDirectoryChain(canonicalRoot, dirname(target));
    writeFileSync(target, entry.data, {
      flag: "wx",
      mode: entry.mode & 0o111 ? 0o700 : 0o600,
    });
  }
  return entries;
}
