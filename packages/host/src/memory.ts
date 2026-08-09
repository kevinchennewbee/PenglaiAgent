/**
 * Two-layer Memory Store (0.4.0 top-level design §6).
 *
 *   Global layer  : <penglai-data-dir>/memory/global/ — the identity's home
 *                   while a conversation is floating. Holds the L1 pointer
 *                   file plus notes.
 *   Project layer : <project-root>/.penglai/memory/ — the anchored project's
 *                   own memory, writable while that project is anchored.
 *
 * Iron rules implemented here:
 *   1. L1 pointer file ≤ 30 lines (MEMORY_L1_MAX_LINES), always injected into
 *      the system prompt. Over-long files are truncated at injection time;
 *      the distillation loop's L1 index section is write-side validated.
 *   2. Anti-pollution: a project-anchored conversation writes ONLY the project
 *      layer. The general
 *      global write channel stays CLOSED (writeGlobalNote always refuses);
 *      the ONLY legitimate door into global memory is the distillation-only
 *      writeGlobalSop (复盘 → 候选 SOP → 审计 → 入树, M2′ C2), which the
 *      audited DistillService calls — never the kernel, never an RPC write.
 *   3. floating injection = global L1 + project memory index (titles only);
 *      project-anchored injection = global L1 + the project's full memory.
 *
 * Notes are plain Markdown. SOP bodies live in `<global>/sop/`, while a
 * Host-only `.audit/<name>.json` receipt binds name, audit source, and body
 * hash; Markdown without a valid receipt is never a skill. L1 carries only
 * the host-managed index of receipt-verified entries.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { Evidence, SopMeta } from "@penglai/protocol";
import {
  MEMORY_INJECT_MAX_BYTES,
  MEMORY_L1_MAX_LINES,
  MEMORY_NOTE_MAX_BYTES,
} from "./policy.js";
import { SEED_SOPS } from "./onboarding/seed-sops.js";

/** The L1 pointer file name inside the global memory root. */
export const L1_FILE_NAME = "L1.md";

/** The global SOP area (the skill tree), relative to the global root. */
export const SOP_DIR_NAME = "sop";

/** Host-only receipt directory. Markdown headers never grant trust by themselves. */
export const SOP_AUDIT_DIR_NAME = ".audit";
export const SOP_AUDIT_POLICY_VERSION = "sop-receipt-v1";
const SOP_MIGRATION_AUTHORITY_KEY_FILE_NAME = ".sop-migration-authority";

export type SopSourceKind = "distill" | "seed" | "migrate";

export interface SopProvenance {
  sourceKind: SopSourceKind;
  sourceTaskId: string | null;
  sourceRunId: string | null;
  sourceRef: string;
  evidenceId: string | null;
  auditedBy: string;
  receiptId?: string;
}

export interface SopReceipt {
  version: 1;
  receiptId: string;
  name: string;
  bodySha256: string;
  sourceKind: SopSourceKind;
  sourceTaskId: string | null;
  sourceRunId: string | null;
  sourceRef: string;
  evidenceId: string | null;
  auditedBy: string;
  auditPolicyVersion: typeof SOP_AUDIT_POLICY_VERSION;
  createdAt: string;
  /** HMAC made with the durable Host migration authority; null otherwise. */
  authorityMac: string | null;
}

export interface TrustedSop {
  meta: SopMeta;
  content: string;
  filePath: string;
  receipt: Readonly<SopReceipt>;
}

export interface SopEvidenceLookup {
  evidenceId: string;
  taskId: string;
  runId: string;
}

export interface MemoryStoreOptions {
  /** Durable ProductStore Evidence lookup. Missing/throwing means fail closed. */
  resolveEvidence?: (lookup: SopEvidenceLookup) => Evidence | null;
  /** Observability hook for the non-authoritative L1 cache/index. */
  onSopIndexError?: (error: Error) => void;
  /** Test-only crash/fault seam; production callers leave this absent. */
  faultInjection?: (point: "before-l1-commit") => void;
}

/** L1 managed section markers (host-owned SOP index; 勿手改). */
const SOP_INDEX_START = "<!-- penglai:sop-index:start -->";
const SOP_INDEX_END = "<!-- penglai:sop-index:end -->";

/** Generic managed-section marker pair (`<!-- penglai:<tag>:start/end -->`). */
function managedMarkers(tag: string): { start: string; end: string } {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(tag)) {
    throw new MemoryError("invalid_name", `invalid managed-section tag: ${JSON.stringify(tag)}`);
  }
  return {
    start: `<!-- penglai:${tag}:start -->`,
    end: `<!-- penglai:${tag}:end -->`,
  };
}

/** The L1 managed tag carrying the identity born in the M3′ ceremony. */
export const IDENTITY_SECTION_TAG = "identity";

/** The identity written into L1 by the birth ceremony (可跳过；二次运行不重复). */
export interface PenglaiIdentity {
  /** Assistant name chosen by the owner (default 蓬莱). */
  name: string;
  /** Birth date, ISO day (YYYY-MM-DD). */
  bornAt: string;
}
/** 待 owner 校准（policy.ts 同款注释面）：L1 里 SOP 指针的最大行数。 */
const SOP_INDEX_MAX_POINTERS = 8;

/** Project-layer memory directory, relative to the project root. */
export const PROJECT_MEMORY_DIR = path.join(".penglai", "memory");

export type MemoryErrorCode =
  | "memory_denied"
  | "needs_work_mode"
  | "memory_not_found"
  | "invalid_name"
  | "note_too_large";

export class MemoryError extends Error {
  constructor(
    public readonly code: MemoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MemoryError";
  }
}

export interface MemoryNoteMeta {
  /** Note name without the .md extension (also the file stem). */
  name: string;
  /** First ATX heading, or the first non-empty line, or the name. */
  title: string;
  sizeBytes: number;
  updatedAt: number;
}

export interface L1ReadResult {
  content: string;
  /** True when the on-disk file exceeded the ≤30-line iron rule. */
  truncated: boolean;
}

/** Seed L1 written on first host start (owner-editable, ≤30 lines). */
export const L1_SEED = `# 蓬莱 · L1 指针（种子，可编辑；≤30 行铁律）

- 同一记忆、同一工具集、同一身份叙事；项目锚定只切目录边界、权限、预算与自主度。
- 全局层只放：身份、偏好、跨项目判断。工作日志与项目细节写项目层，不进全局。
- 锚定项目后只写项目层记忆；写全局层必须过蒸馏环（复盘→候选 SOP→审计→入树）。
- L1 是本文件的铁律：≤30 行，永远注入系统提示词；细节放各笔记，这里只放指针。
`;

/** Normalize + validate a note name; returns the file stem (no extension). */
function noteStem(name: string): string {
  const stem = name.endsWith(".md") ? name.slice(0, -3) : name;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(stem)) {
    throw new MemoryError(
      "invalid_name",
      `invalid memory note name (allowed: A-Z a-z 0-9 _ -, ≤80 chars): ${JSON.stringify(name)}`,
    );
  }
  return stem;
}

/** Extract a display title from note content. */
function noteTitle(stem: string, content: string): string {
  for (const line of content.split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) return heading[1];
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 80);
  }
  return stem;
}

function listNotes(dir: string): MemoryNoteMeta[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const file = path.join(dir, entry.name);
      const stat = fs.statSync(file);
      let content = "";
      try {
        content = fs.readFileSync(file, "utf-8");
      } catch {
        /* unreadable note still lists with a fallback title */
      }
      const stem = entry.name.slice(0, -3);
      return {
        name: stem,
        title: noteTitle(stem, content),
        sizeBytes: stat.size,
        updatedAt: Math.round(stat.mtimeMs),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readNote(dir: string, name: string): string {
  const stem = noteStem(name);
  const file = path.join(dir, `${stem}.md`);
  if (!fs.existsSync(file)) {
    throw new MemoryError("memory_not_found", `memory note not found: ${stem}`);
  }
  return fs.readFileSync(file, "utf-8");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const AUDITOR_PATTERN = /^rules(?:\+[A-Za-z0-9._-]+)*$/;
const SOP_HEADER_PATTERN =
  /^<!-- penglai-sop:v2; receipt=([0-9a-f-]+); name=([A-Za-z0-9][A-Za-z0-9_-]{0,79}); body_sha256=([0-9a-f]{64}); source=(distill|seed|migrate) -->$/;
const RESERVED_MANAGED_NAMESPACE_PATTERN = /<!--\s*penglai:/i;
const MIGRATION_MAC_PATTERN = /^[0-9a-f]{64}$/;

function sha256Text(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

const BUILTIN_SEED_HASHES = new Map(
  SEED_SOPS.map((seed) => [seed.name, sha256Text(seed.content)] as const),
);

function atomicWriteFile(filename: string, content: string): void {
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let fd: number | null = null;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, content, "utf-8");
    fs.fsyncSync(fd);
    const completedFd = fd;
    fd = null;
    fs.closeSync(completedFd);
    fs.renameSync(temporary, filename);
    try {
      const directoryFd = fs.openSync(directory, "r");
      try {
        fs.fsyncSync(directoryFd);
      } finally {
        fs.closeSync(directoryFd);
      }
    } catch {
      // Some platforms cannot open/fsync directories; file fsync still holds.
    }
  } finally {
    if (fd !== null) fs.closeSync(fd);
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Rename consumed it, or creation failed before a temp file existed.
    }
  }
}

function countOccurrences(content: string, marker: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const found = content.indexOf(marker, offset);
    if (found === -1) return count;
    count += 1;
    offset = found + marker.length;
  }
}

function locateManagedSection(
  content: string,
  start: string,
  end: string,
): { startAt: number; endAt: number } | null | "invalid" {
  const startCount = countOccurrences(content, start);
  const endCount = countOccurrences(content, end);
  if (startCount === 0 && endCount === 0) return null;
  if (startCount !== 1 || endCount !== 1) return "invalid";
  const startAt = content.indexOf(start);
  const endAt = content.indexOf(end);
  return startAt < endAt ? { startAt, endAt } : "invalid";
}

function escapeIndexText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function isValidReceipt(value: unknown): value is SopReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  if (
    receipt.version !== 1 ||
    typeof receipt.receiptId !== "string" ||
    !UUID_PATTERN.test(receipt.receiptId) ||
    typeof receipt.name !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(receipt.name) ||
    typeof receipt.bodySha256 !== "string" ||
    !SHA256_PATTERN.test(receipt.bodySha256) ||
    !["distill", "seed", "migrate"].includes(String(receipt.sourceKind)) ||
    typeof receipt.sourceRef !== "string" ||
    !receipt.sourceRef.trim() ||
    receipt.sourceRef.length > 1024 ||
    typeof receipt.auditedBy !== "string" ||
    !AUDITOR_PATTERN.test(receipt.auditedBy) ||
    receipt.auditPolicyVersion !== SOP_AUDIT_POLICY_VERSION ||
    typeof receipt.createdAt !== "string" ||
    !Number.isFinite(Date.parse(receipt.createdAt)) ||
    !(receipt.authorityMac === null ||
      (typeof receipt.authorityMac === "string" && MIGRATION_MAC_PATTERN.test(receipt.authorityMac)))
  ) {
    return false;
  }
  const nullableUuid = (entry: unknown) =>
    entry === null || (typeof entry === "string" && UUID_PATTERN.test(entry));
  if (
    !nullableUuid(receipt.sourceTaskId) ||
    !nullableUuid(receipt.sourceRunId) ||
    !nullableUuid(receipt.evidenceId)
  ) {
    return false;
  }
  if (receipt.sourceKind === "distill") {
    return (
      typeof receipt.sourceTaskId === "string" &&
      typeof receipt.sourceRunId === "string" &&
      typeof receipt.evidenceId === "string" &&
      receipt.sourceRef ===
        `task:${receipt.sourceTaskId}/run:${receipt.sourceRunId}` &&
      receipt.authorityMac === null &&
      (receipt.auditedBy === "rules" || receipt.auditedBy === "rules+llm")
    );
  }
  return (
    receipt.sourceTaskId === null &&
    receipt.sourceRunId === null &&
    receipt.evidenceId === null &&
    (receipt.sourceKind === "seed"
      ? receipt.sourceRef.startsWith("builtin:") &&
        receipt.sourceRef.endsWith(`/${receipt.name}`) &&
        receipt.authorityMac === null &&
        receipt.auditedBy === "rules+seed-ceremony"
      : receipt.sourceRef.startsWith("migration:") &&
        typeof receipt.authorityMac === "string" &&
        receipt.auditedBy === "rules+migrate-03")
  );
}

/** Truncate text to a byte budget, appending a marker when truncated. */
function capBytes(text: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(text, "utf-8");
  if (bytes <= maxBytes) return text;
  const sliced = Buffer.from(text, "utf-8")
    .subarray(0, maxBytes)
    .toString("utf-8");
  return `${sliced}\n…(truncated: ${bytes - maxBytes} bytes omitted)`;
}

export class MemoryStore {
  /**
   * @param globalRoot  the global memory root, i.e.
   *                    `<penglai-data-dir>/memory/global`.
   */
  constructor(
    public readonly globalRoot: string,
    private readonly options: MemoryStoreOptions = {},
  ) {}

  private reportSopIndexError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    try {
      this.options.onSopIndexError?.(normalized);
    } catch {
      // Observability must never change trust or commit semantics.
    }
  }

  private atomicL1Write(filename: string, content: string): void {
    this.options.faultInjection?.("before-l1-commit");
    atomicWriteFile(filename, content);
  }

  /** The project-layer memory directory for a given project root. */
  static projectDir(projectRoot: string): string {
    return path.join(projectRoot, PROJECT_MEMORY_DIR);
  }

  // ── layout ───────────────────────────────────────────────────

  /**
   * Create the global memory layout on first start: the root directory
   * (0o700) plus the seed L1 pointer file (0o600) when absent. Never
   * overwrites an existing L1.
   */
  ensureGlobalLayout(): void {
    fs.mkdirSync(this.globalRoot, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(this.globalRoot, 0o700);
    } catch {
      /* best-effort permission hardening */
    }
    const l1 = path.join(this.globalRoot, L1_FILE_NAME);
    if (!fs.existsSync(l1)) {
      fs.writeFileSync(l1, L1_SEED, { encoding: "utf-8", mode: 0o600 });
    }
  }

  // ── global layer (chat-mode home) ────────────────────────────

  /**
   * Read the L1 pointer file, enforcing the ≤30-line iron rule at injection
   * time: an over-long file is truncated with a marker (write-side
   * validation arrives with the M2′ distillation loop).
   */
  readGlobalL1(): L1ReadResult {
    const file = path.join(this.globalRoot, L1_FILE_NAME);
    if (!fs.existsSync(file) && !fs.existsSync(this.sopRoot)) {
      return { content: "", truncated: false };
    }
    // Rebuild from verified receipts at injection time so a revoked, missing,
    // corrupted, or tampered SOP cannot survive through a stale disk pointer.
    // The returned view is freshly rendered even if persisting the cache fails.
    const lines = this.refreshL1SopIndex().split("\n");
    if (lines.length <= MEMORY_L1_MAX_LINES) {
      return { content: lines.join("\n").trim(), truncated: false };
    }
    const head = lines.slice(0, MEMORY_L1_MAX_LINES).join("\n");
    return {
      content: `${head}\n…(L1 truncated: ${lines.length - MEMORY_L1_MAX_LINES} lines over the ${MEMORY_L1_MAX_LINES}-line iron rule)`,
      truncated: true,
    };
  }

  /** Index of global notes (titles + stats). L1 itself is listed separately. */
  listGlobal(): MemoryNoteMeta[] {
    return listNotes(this.globalRoot).filter((n) => n.name !== "L1");
  }

  /** Read one global note by name. Throws memory_not_found when absent. */
  readGlobalNote(name: string): string {
    return readNote(this.globalRoot, name);
  }

  /**
   * CLOSED CHANNEL. Global memory is the identity's long-term ground; the
   * general write path stays refused under every mode. The ONLY legitimate
   * door is the distillation loop's audited writeGlobalSop below
   * (复盘 → 候选 SOP → 审计 → 入树) — callable by the DistillService,
   * never by the kernel or an RPC write.
   */
  writeGlobalNote(name: string, _content: string): never {
    void noteStem(name); // still validate so callers get deterministic errors
    throw new MemoryError(
      "memory_denied",
      "global memory writes stay closed outside the audited distillation loop " +
        "(复盘 -> 候选 SOP -> 审计 -> 入树); project memory is writable when anchored",
    );
  }

  // ── L1 managed sections (identity / migration; host-owned) ────

  /**
   * Read one host-managed section of L1 (`<!-- penglai:<tag>:start/end -->`).
   * Returns the lines between the markers, or null when the section is absent.
   */
  readManagedSection(tag: string): string[] | null {
    const file = path.join(this.globalRoot, L1_FILE_NAME);
    if (!fs.existsSync(file)) return null;
    const current = fs.readFileSync(file, "utf-8");
    const { start, end } = managedMarkers(tag);
    const location = locateManagedSection(current, start, end);
    if (!location || location === "invalid") return null;
    return current
      .slice(location.startAt + start.length, location.endAt)
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line, index, lines) => !(line.trim() === "" && (index === 0 || index === lines.length - 1)));
  }

  /**
   * Insert or replace one host-managed L1 section. Owner-authored content
   * outside the markers is never touched; an empty `lines` removes the
   * section. Write-side ≤30-line iron rule: when the merged file would
   * exceed the cap, the section is NOT written and false is returned (the
   * caller decides what to archive instead).
   */
  writeManagedSection(tag: string, lines: string[]): boolean {
    this.ensureGlobalLayout();
    const file = path.join(this.globalRoot, L1_FILE_NAME);
    const current = fs.readFileSync(file, "utf-8");
    const { start, end } = managedMarkers(tag);
    if (lines.some((line) => RESERVED_MANAGED_NAMESPACE_PATTERN.test(line))) {
      return false;
    }
    const section = lines.length > 0 ? [start, ...lines, end].join("\n") : "";
    let next: string;
    const location = locateManagedSection(current, start, end);
    if (location === "invalid") return false;
    if (location) {
      const before = current.slice(0, location.startAt).replace(/\s+$/, "");
      const after = current.slice(location.endAt + end.length).replace(/^\s+/, "");
      next = [before, section, after].filter((part) => part.length > 0).join("\n\n");
    } else if (section.length > 0) {
      next = `${current.replace(/\s+$/, "")}\n\n${section}\n`;
    } else {
      next = current;
    }
    // 与 readGlobalL1 同一口径：原始 split 行数 ≤ 30（正文 29 行 + 尾换行）。
    const finalText = next.endsWith("\n") ? next : `${next}\n`;
    const lineCount = finalText.split("\n").length;
    if (lineCount > MEMORY_L1_MAX_LINES) return false;
    this.atomicL1Write(file, finalText);
    return true;
  }

  /**
   * The identity born in the first-run ceremony, read from the L1 managed
   * identity section. Null until the ceremony has run (identity is skippable).
   */
  readIdentity(): PenglaiIdentity | null {
    const lines = this.readManagedSection(IDENTITY_SECTION_TAG);
    if (!lines) return null;
    let name: string | null = null;
    let bornAt: string | null = null;
    for (const line of lines) {
      const nameMatch = line.match(/^-\s*名字：(.+)$/);
      if (nameMatch) name = nameMatch[1].trim();
      const bornMatch = line.match(/^-\s*诞生日：(\d{4}-\d{2}-\d{2})$/);
      if (bornMatch) bornAt = bornMatch[1];
    }
    return name && bornAt ? { name, bornAt } : null;
  }

  /**
   * Ceremony write: the identity lands in the global L1 managed section
   * (名字 + 诞生日). Idempotent — the same identity rewrites to identical
   * content; the ceremony itself is responsible for not re-running.
   */
  writeIdentity(identity: PenglaiIdentity): boolean {
    return this.writeManagedSection(IDENTITY_SECTION_TAG, [
      "## 身份（诞生仪式落笔，host 托管，勿手改）",
      `- 名字：${identity.name}`,
      `- 诞生日：${identity.bornAt}`,
    ]);
  }

  /**
   * Owner-tooling archive write (migrate / ceremony only — NEVER the kernel,
   * NEVER an RPC). The anti-pollution iron rule (writeGlobalNote stays a
   * dead wall) guards the agent; this channel exists for the owner's own
   * offline tooling to file 0.3 material into the global archive area.
   */
  writeGlobalArchive(name: string, content: string): MemoryNoteMeta {
    const stem = noteStem(name);
    const sizeBytes = Buffer.byteLength(content, "utf-8");
    if (sizeBytes > MEMORY_NOTE_MAX_BYTES) {
      throw new MemoryError(
        "note_too_large",
        `archive note exceeds the ${MEMORY_NOTE_MAX_BYTES}-byte cap (${sizeBytes} bytes)`,
      );
    }
    fs.mkdirSync(this.globalRoot, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(this.globalRoot, `${stem}.md`), content, {
      encoding: "utf-8",
      mode: 0o600,
    });
    return {
      name: stem,
      title: noteTitle(stem, content),
      sizeBytes,
      updatedAt: Date.now(),
    };
  }

  // ── global SOP area (the skill tree; distillation-only writes) ──

  /** The SOP area directory (`<global>/sop/`). */
  get sopRoot(): string {
    return path.join(this.globalRoot, SOP_DIR_NAME);
  }

  /** Host-only provenance receipts; never exposed as model resources. */
  get sopAuditRoot(): string {
    return path.join(this.sopRoot, SOP_AUDIT_DIR_NAME);
  }

  /** Durable Host-only key used to authenticate owner migration receipts. */
  sopMigrationAuthorityFile(): string {
    return path.join(this.globalRoot, SOP_MIGRATION_AUTHORITY_KEY_FILE_NAME);
  }

  private sopReceiptPath(stem: string): string {
    return path.join(this.sopAuditRoot, `${stem}.json`);
  }

  /** Owner migration/rollback tooling must back up the receipt with the body. */
  sopReceiptFile(name: string): string {
    return this.sopReceiptPath(noteStem(name));
  }

  private readMigrationAuthorityKey(): Buffer | null {
    const filename = this.sopMigrationAuthorityFile();
    try {
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) return null;
      if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) return null;
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return null;
      const encoded = fs.readFileSync(filename, "utf-8").trim();
      if (!/^[0-9a-f]{64}$/.test(encoded)) return null;
      return Buffer.from(encoded, "hex");
    } catch {
      return null;
    }
  }

  private ensureMigrationAuthorityKey(): Buffer {
    const existing = this.readMigrationAuthorityKey();
    if (existing) return existing;
    fs.mkdirSync(this.globalRoot, { recursive: true, mode: 0o700 });
    const filename = this.sopMigrationAuthorityFile();
    const encoded = crypto.randomBytes(32).toString("hex");
    let fd: number | null = null;
    try {
      fd = fs.openSync(filename, "wx", 0o600);
      fs.writeFileSync(fd, `${encoded}\n`, "utf-8");
      fs.fsyncSync(fd);
      const completedFd = fd;
      fd = null;
      fs.closeSync(completedFd);
      try {
        const directoryFd = fs.openSync(this.globalRoot, "r");
        try {
          fs.fsyncSync(directoryFd);
        } finally {
          fs.closeSync(directoryFd);
        }
      } catch {
        // Directory fsync is not supported on every platform/filesystem.
      }
      return Buffer.from(encoded, "hex");
    } catch (error) {
      if (fd !== null) {
        fs.closeSync(fd);
        fd = null;
      }
      const raced = this.readMigrationAuthorityKey();
      if (raced) return raced;
      throw error;
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }

  private receiptMacPayload(receipt: SopReceipt): string {
    return JSON.stringify([
      receipt.version,
      receipt.receiptId,
      receipt.name,
      receipt.bodySha256,
      receipt.sourceKind,
      receipt.sourceTaskId,
      receipt.sourceRunId,
      receipt.sourceRef,
      receipt.evidenceId,
      receipt.auditedBy,
      receipt.auditPolicyVersion,
      receipt.createdAt,
    ]);
  }

  private migrationReceiptMac(receipt: SopReceipt, key: Buffer): string {
    return crypto
      .createHmac("sha256", key)
      .update(this.receiptMacPayload(receipt), "utf-8")
      .digest("hex");
  }

  private verifyMigrationReceipt(receipt: SopReceipt): boolean {
    if (typeof receipt.authorityMac !== "string") return false;
    const key = this.readMigrationAuthorityKey();
    if (!key) return false;
    try {
      const expected = Buffer.from(this.migrationReceiptMac(receipt, key), "hex");
      const received = Buffer.from(receipt.authorityMac, "hex");
      return expected.length === received.length && crypto.timingSafeEqual(expected, received);
    } finally {
      key.fill(0);
    }
  }

  private verifyDistillEvidence(receipt: SopReceipt): boolean {
    if (
      receipt.sourceKind !== "distill" ||
      !receipt.evidenceId ||
      !receipt.sourceTaskId ||
      !receipt.sourceRunId ||
      !this.options.resolveEvidence
    ) {
      return false;
    }
    try {
      const evidence = this.options.resolveEvidence({
        evidenceId: receipt.evidenceId,
        taskId: receipt.sourceTaskId,
        runId: receipt.sourceRunId,
      });
      if (!evidence) return false;
      const metadata = evidence.metadata ?? {};
      return (
        evidence.id === receipt.evidenceId &&
        evidence.taskId === receipt.sourceTaskId &&
        evidence.runId === receipt.sourceRunId &&
        evidence.kind === "artifact" &&
        evidence.sha256 === receipt.bodySha256 &&
        metadata.receiptId === receipt.receiptId &&
        metadata.sopName === receipt.name &&
        metadata.auditedBy === receipt.auditedBy &&
        metadata.sourceTaskId === receipt.sourceTaskId &&
        metadata.sourceRunId === receipt.sourceRunId &&
        metadata.bodySha256 === receipt.bodySha256
      );
    } catch {
      return false;
    }
  }

  private isReceiptAuthoritative(receipt: SopReceipt): boolean {
    switch (receipt.sourceKind) {
      case "distill":
        return this.verifyDistillEvidence(receipt);
      case "seed":
        return BUILTIN_SEED_HASHES.get(receipt.name) === receipt.bodySha256;
      case "migrate":
        return this.verifyMigrationReceipt(receipt);
    }
  }

  /**
   * Read and verify one SOP from one Markdown buffer plus its Host receipt.
   * Any missing, malformed, mismatched, symlinked, or tampered state is
   * quarantined logically by returning null; there is no legacy fallback.
   */
  loadTrustedSop(name: string): TrustedSop | null {
    const stem = noteStem(name);
    const filePath = path.join(this.sopRoot, `${stem}.md`);
    const receiptPath = this.sopReceiptPath(stem);
    try {
      const fileStat = fs.lstatSync(filePath);
      const receiptStat = fs.lstatSync(receiptPath);
      if (
        !fileStat.isFile() ||
        fileStat.isSymbolicLink() ||
        !receiptStat.isFile() ||
        receiptStat.isSymbolicLink()
      ) {
        return null;
      }
      const raw = fs.readFileSync(filePath, "utf-8");
      const newline = raw.indexOf("\n");
      if (newline < 0) return null;
      const header = raw.slice(0, newline);
      const body = raw.slice(newline + 1);
      const match = header.match(SOP_HEADER_PATTERN);
      if (!match) return null;
      const [, receiptId, headerName, headerSha256, headerSource] = match;
      const parsed = JSON.parse(fs.readFileSync(receiptPath, "utf-8")) as unknown;
      if (!isValidReceipt(parsed)) return null;
      const receipt = parsed;
      const bodySha256 = sha256Text(body);
      if (
        receiptId !== receipt.receiptId ||
        headerName !== stem ||
        receipt.name !== stem ||
        headerSha256 !== bodySha256 ||
        receipt.bodySha256 !== bodySha256 ||
        headerSource !== receipt.sourceKind ||
        !this.isReceiptAuthoritative(receipt)
      ) {
        return null;
      }
      return {
        meta: {
          name: stem,
          title: noteTitle(stem, body),
          sizeBytes: Buffer.byteLength(body, "utf-8"),
          updatedAt: Math.round(fileStat.mtimeMs),
          sourceTaskId: receipt.sourceTaskId,
          sourceRunId: receipt.sourceRunId,
        },
        content: body,
        filePath,
        receipt,
      };
    } catch {
      return null;
    }
  }

  /** One verified read supplies metadata, body, and Pi resource content. */
  loadTrustedSops(): TrustedSop[] {
    return listNotes(this.sopRoot)
      .map((note) => this.loadTrustedSop(note.name))
      .filter((entry): entry is TrustedSop => entry !== null);
  }

  private quarantineUntrustedSop(stem: string): void {
    const filePath = path.join(this.sopRoot, `${stem}.md`);
    const receiptPath = this.sopReceiptPath(stem);
    if (!fs.existsSync(filePath) && !fs.existsSync(receiptPath)) return;
    const quarantineRoot = path.join(this.globalRoot, "sop-quarantine");
    fs.mkdirSync(quarantineRoot, { recursive: true, mode: 0o700 });
    const suffix = `${Date.now()}-${crypto.randomUUID()}`;
    for (const [source, extension] of [[filePath, "md"], [receiptPath, "json"]] as const) {
      if (!fs.existsSync(source)) continue;
      fs.renameSync(source, path.join(quarantineRoot, `${stem}-${suffix}.${extension}`));
    }
  }

  /**
   * THE distillation-only write channel into global memory (design §6:
   * work → 全局记忆必须过蒸馏环). Callable only by the audited
   * DistillService / audited seed / migration path. The Markdown header is
   * only a pointer: trust comes from a separate hash-bound Host receipt.
   * A failed or partial write stays invisible to every model consumption path.
   */
  writeGlobalSop(
    name: string,
    content: string,
    provenance: SopProvenance,
  ): SopMeta {
    const stem = noteStem(name);
    const sizeBytes = Buffer.byteLength(content, "utf-8");
    if (sizeBytes > MEMORY_NOTE_MAX_BYTES) {
      throw new MemoryError(
        "note_too_large",
        `SOP exceeds the ${MEMORY_NOTE_MAX_BYTES}-byte cap (${sizeBytes} bytes)`,
      );
    }
    if (RESERVED_MANAGED_NAMESPACE_PATTERN.test(content)) {
      throw new MemoryError(
        "memory_denied",
        "SOP content may not use the reserved '<!-- penglai:' Host marker namespace",
      );
    }
    const receipt: SopReceipt = {
      version: 1,
      receiptId: provenance.receiptId ?? crypto.randomUUID(),
      name: stem,
      bodySha256: sha256Text(content),
      sourceKind: provenance.sourceKind,
      sourceTaskId: provenance.sourceTaskId,
      sourceRunId: provenance.sourceRunId,
      sourceRef: provenance.sourceRef,
      evidenceId: provenance.evidenceId,
      auditedBy: provenance.auditedBy,
      auditPolicyVersion: SOP_AUDIT_POLICY_VERSION,
      createdAt: new Date().toISOString(),
      authorityMac: null,
    };
    if (receipt.sourceKind === "migrate") {
      const key = this.ensureMigrationAuthorityKey();
      try {
        receipt.authorityMac = this.migrationReceiptMac(receipt, key);
      } finally {
        key.fill(0);
      }
    }
    if (!isValidReceipt(receipt)) {
      throw new MemoryError("memory_denied", "invalid or incomplete SOP audit provenance");
    }
    if (!this.isReceiptAuthoritative(receipt)) {
      throw new MemoryError("memory_denied", "SOP provenance has no authoritative audit record");
    }

    if (
      fs.existsSync(path.join(this.sopRoot, `${stem}.md`)) &&
      !this.loadTrustedSop(stem)
    ) {
      this.quarantineUntrustedSop(stem);
    }
    fs.mkdirSync(this.sopRoot, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.sopAuditRoot, { recursive: true, mode: 0o700 });
    const header =
      `<!-- penglai-sop:v2; receipt=${receipt.receiptId}; name=${stem}; ` +
      `body_sha256=${receipt.bodySha256}; source=${receipt.sourceKind} -->\n`;
    const bodyPath = path.join(this.sopRoot, `${stem}.md`);
    // Markdown first, receipt last: a crash between the two leaves an
    // untrusted file. The receipt rename is the final commit marker.
    atomicWriteFile(bodyPath, header + content);
    const meta: SopMeta = {
      name: stem,
      title: noteTitle(stem, content),
      sizeBytes,
      updatedAt: Math.round(fs.statSync(bodyPath).mtimeMs),
      sourceTaskId: receipt.sourceTaskId,
      sourceRunId: receipt.sourceRunId,
    };
    atomicWriteFile(this.sopReceiptPath(stem), `${JSON.stringify(receipt, null, 2)}\n`);
    // L1 is a rebuildable cache of verified entries, not an authority source.
    // A post-commit cache failure must not turn a committed SOP into a reported
    // write failure; injection still derives its in-memory view from receipts.
    this.refreshL1SopIndex();
    return meta;
  }

  /** Index of receipt-verified SOPs (skill tree view for owner/model tools). */
  listSops(): SopMeta[] {
    return this.loadTrustedSops().map((entry) => entry.meta);
  }

  /** Read one trusted SOP body. Missing/untrusted/tampered all fail closed. */
  readSop(name: string): string {
    const stem = noteStem(name);
    const trusted = this.loadTrustedSop(stem);
    if (!trusted) {
      throw new MemoryError("memory_not_found", `trusted SOP not found: ${stem}`);
    }
    return trusted.content;
  }

  /**
   * Owner removal (`memory sop remove`): delete the SOP file and refresh the
   * L1 index. Returns false when the SOP did not exist.
   */
  removeSop(name: string): boolean {
    const stem = noteStem(name);
    const file = path.join(this.sopRoot, `${stem}.md`);
    const receipt = this.sopReceiptPath(stem);
    if (!fs.existsSync(file) && !fs.existsSync(receipt)) return false;
    if (fs.existsSync(file)) fs.rmSync(file);
    if (fs.existsSync(receipt)) fs.rmSync(receipt);
    this.refreshL1SopIndex();
    return true;
  }

  /**
   * Re-render the L1 SOP index from the actual tree (idempotent). Public for
   * owner tooling (migrate rollback) that deletes planted SOP files directly;
   * the distillation path refreshes via writeGlobalSop/removeSop internally.
   */
  refreshSopIndex(): void {
    this.refreshL1SopIndex();
  }

  /**
   * Rewrite the host-managed SOP index section inside L1.md (between the
   * penglai:sop-index markers). Owner-authored content outside the markers
   * is never touched; the section disappears entirely when the tree is
   * empty. The ≤30-line iron rule is enforced write-side here: pointer
   * lines are capped (SOP_INDEX_MAX_POINTERS) with an overflow marker.
   */
  private renderL1SopIndex(current: string, sops: SopMeta[]): string {
    let sectionLines: string[] = [];
    if (sops.length > 0) {
      const pointers = sops
        .slice(0, SOP_INDEX_MAX_POINTERS)
        .map((sop) => `- sop/${sop.name} — ${escapeIndexText(sop.title)}`);
      const overflow = sops.length - SOP_INDEX_MAX_POINTERS;
      if (overflow > 0) {
        pointers.push(`- … 另有 ${overflow} 条（penglai memory sop list）`);
      }
      sectionLines = [
        SOP_INDEX_START,
        "## SOP 技能树索引（蒸馏环维护，勿手改）",
        ...pointers,
        SOP_INDEX_END,
      ];
    }
    const section = sectionLines.join("\n");

    let next: string;
    const location = locateManagedSection(current, SOP_INDEX_START, SOP_INDEX_END);
    if (location === "invalid") {
      throw new MemoryError(
        "memory_denied",
        "L1 SOP index markers must be one unique, ordered start/end pair",
      );
    }
    if (location) {
      const before = current.slice(0, location.startAt).replace(/\s+$/, "");
      const after = current.slice(location.endAt + SOP_INDEX_END.length).replace(/^\s+/, "");
      next = [before, section, after].filter((part) => part.length > 0).join("\n\n");
    } else if (section.length > 0) {
      const owner = current.replace(/\s+$/, "");
      next = owner.length > 0 ? `${owner}\n\n${section}\n` : `${section}\n`;
    } else {
      next = current;
    }

    // 写侧铁律：L1 仍超 30 行时收紧指针区（指针让位于 owner 正文）。
    let lines = next.split("\n");
    if (lines.length > MEMORY_L1_MAX_LINES && sops.length > 0) {
      const minimal = [
        SOP_INDEX_START,
        `## SOP 技能树索引（${sops.length} 条，penglai memory sop list）`,
        SOP_INDEX_END,
      ].join("\n");
      const minimalLocation = locateManagedSection(next, SOP_INDEX_START, SOP_INDEX_END);
      if (!minimalLocation || minimalLocation === "invalid") {
        throw new MemoryError("memory_denied", "failed to render a unique ordered SOP index");
      }
      next =
        next.slice(0, minimalLocation.startAt).replace(/\s+$/, "") +
        "\n\n" +
        minimal +
        "\n" +
        next.slice(minimalLocation.endAt + SOP_INDEX_END.length).replace(/^\s+/, "");
      lines = next.split("\n");
    }
    return next.length === 0 || next.endsWith("\n") ? next : `${next}\n`;
  }

  private safeL1Prefix(current: string): string {
    const reserved = current.match(RESERVED_MANAGED_NAMESPACE_PATTERN);
    if (reserved?.index !== undefined) return current.slice(0, reserved.index).replace(/\s+$/, "");
    return current;
  }

  private refreshL1SopIndex(): string {
    const l1File = path.join(this.globalRoot, L1_FILE_NAME);
    const current = fs.existsSync(l1File)
      ? fs.readFileSync(l1File, "utf-8")
      : "";
    let output: string;
    try {
      output = this.renderL1SopIndex(current, this.listSops());
    } catch (error) {
      this.reportSopIndexError(error);
      return this.safeL1Prefix(current);
    }
    if (output !== current) {
      try {
        this.atomicL1Write(l1File, output);
      } catch (error) {
        // Receipt verification is authoritative; L1 is only a rebuildable
        // pointer cache. Keep serving the freshly rendered in-memory view.
        this.reportSopIndexError(error);
      }
    }
    return output;
  }

  // ── project layer (anchored project memory) ──────────────────

  /** Index of the project's memory notes (titles + stats). */
  listProject(projectRoot: string): MemoryNoteMeta[] {
    return listNotes(MemoryStore.projectDir(projectRoot));
  }

  /** Read one project note by name. Throws memory_not_found when absent. */
  readProjectNote(projectRoot: string, name: string): string {
    return readNote(MemoryStore.projectDir(projectRoot), name);
  }

  /**
   * Write one project note. Anti-pollution iron rule: project memory is
   * writable only when a project is actually anchored. The caller must pass
   * `anchored: true` (derived from the conversation's activeTaskId), NOT a
   * self-declared compatibility label - this closes the old forged-anchor
   * bypass. A floating session must propose anchoring a project first.
   */
  writeProjectNote(
    projectRoot: string,
    name: string,
    content: string,
    ctx: { anchored: boolean },
  ): MemoryNoteMeta {
    if (!ctx.anchored) {
      throw new MemoryError(
        "needs_work_mode",
        "project memory is writable only when a project is anchored; " +
          "propose anchoring a project (mode.proposeWork) first",
      );
    }
    const stem = noteStem(name);
    const sizeBytes = Buffer.byteLength(content, "utf-8");
    if (sizeBytes > MEMORY_NOTE_MAX_BYTES) {
      throw new MemoryError(
        "note_too_large",
        `memory note exceeds the ${MEMORY_NOTE_MAX_BYTES}-byte cap (${sizeBytes} bytes)`,
      );
    }
    const dir = MemoryStore.projectDir(projectRoot);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${stem}.md`), content, "utf-8");
    return {
      name: stem,
      title: noteTitle(stem, content),
      sizeBytes,
      updatedAt: Date.now(),
    };
  }

  // ── system-prompt injection ──────────────────────────────────

  /**
   * Lightweight injection: global L1 (always includes SOP index) + project
   * memory titles only. Used when there is no project anchor / floating chat.
   */
  buildChatInjection(projectRoot?: string | null): string {
    const sections: string[] = [];
    const l1 = this.readGlobalL1();
    sections.push(`## 记忆 · 全局 L1（始终加载）\n${l1.content || "(empty)"}`);
    sections.push(
      "技能树：可用 skill_list / skill_show 读取蒸馏 SOP 全文（L1 仅含索引指针）。",
    );
    if (projectRoot) {
      const notes = this.listProject(projectRoot);
      const index =
        notes.length === 0
          ? "(no project memory yet)"
          : notes.map((n) => `- ${n.title} (\`${n.name}\`)`).join("\n");
      sections.push(`## 项目记忆索引（标题）\n${index}`);
    }
    return capBytes(sections.join("\n\n"), MEMORY_INJECT_MAX_BYTES);
  }

  /**
   * Anchored injection: global L1 + full project memory for the workspace jail.
   * (Conversation surface always uses full tools; this only changes memory depth.)
   */
  buildWorkInjection(projectRoot: string): string {
    const sections: string[] = [];
    const l1 = this.readGlobalL1();
    sections.push(`## 记忆 · 全局 L1（始终加载）\n${l1.content || "(empty)"}`);
    sections.push(
      "技能树：可用 skill_list / skill_show 读取蒸馏 SOP 全文（L1 仅含索引指针）。",
    );
    const notes = this.listProject(projectRoot);
    if (notes.length === 0) {
      sections.push(
        "## 项目记忆（工作区全量加载，可写）\n(no project memory yet — write durable findings to .penglai/memory/)",
      );
      return capBytes(sections.join("\n\n"), MEMORY_INJECT_MAX_BYTES);
    }
    // Newest-first, stop reading once inject budget is nearly spent (IO + tokens).
    const sorted = notes.slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const parts: string[] = [];
    let used = 0;
    const budget = Math.max(2_000, MEMORY_INJECT_MAX_BYTES - 2_000);
    for (const n of sorted) {
      if (used >= budget) {
        parts.push(`… 另有 ${sorted.length - parts.length} 条笔记未注入（预算 ${MEMORY_INJECT_MAX_BYTES}B）`);
        break;
      }
      const body = this.readProjectNote(projectRoot, n.name).trim();
      const chunk = `### ${n.title} (\`${n.name}.md\`)\n${body}`;
      parts.push(chunk);
      used += chunk.length;
    }
    sections.push(`## 项目记忆（工作区加载，可写）\n${parts.join("\n\n")}`);
    return capBytes(sections.join("\n\n"), MEMORY_INJECT_MAX_BYTES);
  }
}
