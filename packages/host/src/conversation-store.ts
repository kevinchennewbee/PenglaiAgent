/**
 * Conversation Store - append-only JSONL transcript persistence.
 *
 * Each conversation lives in its own directory:
 *   ~/.penglai/conversations/<conversationId>/transcript.jsonl
 *
 * One JSON-encoded Message per line. Append-only: editing history means
 * appending lines, never rewriting. The conversation transcript is the single
 * source of truth for the dialog, which keeps crash recovery trivial.
 *
 * Durable work state (Task/Run/Step/Evidence) lives in the product database
 * (storage/product-store.ts), not here.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import type { Message } from "@penglai/protocol";
import { penglaiDataDir } from "./data-dir.js";
import {
  appendPrivateLine,
  atomicWritePrivateJson,
  ensurePrivateDirectory,
  hardenPrivateFile,
} from "./security/private-file.js";

const MAX_CONVERSATION_META_BYTES = 2 * 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 512 * 1024 * 1024;

// ── home resolution ────────────────────────────────────────────

/**
 * The Penglai home directory. Defaults to the single product data root
 * (`penglaiDataDir()` → `PENGLAI_DATA_DIR` or `~/.penglai`); overridable for
 * tests via `_setPenglaiHomeForTest`. Conversations, scheduler, and logs live
 * under this root so one override isolates an entire test run.
 *
 * IMPORTANT: this must stay unified with product.db / host.token / profiles.
 * A prior split (home always `~/.penglai` while dataDir respected env) caused
 * desktop vs CLI token/data divergence.
 */
let homeOverride: string | null = null;

/** Resolve the Penglai home directory (same root as `penglaiDataDir()` unless overridden). */
export function penglaiHome(): string {
  return homeOverride ?? penglaiDataDir();
}

/**
 * Override the Penglai home directory (test isolation). Pass `null` to reset.
 * @internal
 */
export function _setPenglaiHomeForTest(dir: string | null): void {
  homeOverride = dir;
}

// ── conversation paths ─────────────────────────────────────────

/** Conversation ids are used directly as directory names, so they must be safe
 *  path components (no traversal, no separators). */
function assertValidConversationId(conversationId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(conversationId)) {
    throw new Error(
      `invalid conversationId (allowed: A-Z a-z 0-9 _ -): ${JSON.stringify(conversationId)}`,
    );
  }
}

function conversationDir(conversationId: string): string {
  assertValidConversationId(conversationId);
  return path.join(conversationsBaseDir(), conversationId);
}

function transcriptPath(conversationId: string): string {
  return path.join(conversationDir(conversationId), "transcript.jsonl");
}

// ── message persistence ────────────────────────────────────────

/** Append a single message to the conversation transcript (creates dirs as
 *  needed). */
export function saveMessage(conversationId: string, message: Message): void {
  ensurePrivateDirectory(conversationsBaseDir());
  const dir = conversationDir(conversationId);
  ensurePrivateDirectory(dir);
  appendPrivateLine(transcriptPath(conversationId), JSON.stringify(message));
}

/**
 * Durable conversation metadata (profile / mode / title / anchor). Survives
 * host restart so prompt does not lose modelProfileId after hydrate.
 */
/**
 * Extra context the owner pinned into this conversation (files, skills, notes).
 * Injected into the system prompt each episode — not a second chat surface.
 */
export interface ConversationContextPin {
  id: string;
  kind: "file" | "skill" | "note" | "mcp" | "url" | "session";
  /** Display label */
  label: string;
  /** Absolute path / skill name / free text / mcp server id / url / conversation id */
  ref: string;
  createdAt: number;
}

export interface ConversationMeta {
  id: string;
  workspaceId?: string;
  title?: string;
  status?: string;
  modelProfileId?: string;
  mode?: "chat" | "work";
  activeTaskId?: string | null;
  /**
   * Active goal text (ZCode session/goal analogue). While set, the agent
   * treats the conversation as goal-oriented; plan dial is recommended until
   * the owner switches to auto_edit/full for execution.
   */
  goal?: string | null;
  /** Optional pins always re-injected into context. */
  contextPins?: ConversationContextPin[];
  createdAt?: number;
  updatedAt?: number;
}

function metaPath(conversationId: string): string {
  return path.join(conversationDir(conversationId), "meta.json");
}

export function saveConversationMeta(meta: ConversationMeta): void {
  ensurePrivateDirectory(conversationsBaseDir());
  const dir = conversationDir(meta.id);
  ensurePrivateDirectory(dir);
  const file = metaPath(meta.id);
  atomicWritePrivateJson(file, meta, MAX_CONVERSATION_META_BYTES);
}

export function loadConversationMeta(conversationId: string): ConversationMeta | null {
  if (!fs.existsSync(conversationsBaseDir())) return null;
  ensurePrivateDirectory(conversationsBaseDir());
  const file = metaPath(conversationId);
  try {
    if (!fs.existsSync(file)) return null;
    hardenPrivateFile(file, MAX_CONVERSATION_META_BYTES);
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as ConversationMeta;
    if (!raw || raw.id !== conversationId) return null;
    return raw;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Private")) throw error;
    return null;
  }
}

/** Read every message from a conversation transcript. Returns [] if none yet. */
export function loadMessages(conversationId: string): Message[] {
  if (!fs.existsSync(conversationsBaseDir())) return [];
  ensurePrivateDirectory(conversationsBaseDir());
  const file = transcriptPath(conversationId);
  if (!fs.existsSync(file)) return [];
  hardenPrivateFile(file, MAX_TRANSCRIPT_BYTES);
  const text = fs.readFileSync(file, "utf-8");
  const messages: Message[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed) as Message);
    } catch {
      // Skip a corrupt line rather than aborting the whole conversation.
    }
  }
  return messages;
}

// ── conversation enumeration ───────────────────────────────────

/** List all conversation ids (directory names under the conversations root),
 *  sorted. */
export function listConversations(): string[] {
  const base = conversationsBaseDir();
  if (!fs.existsSync(base)) return [];
  ensurePrivateDirectory(base);
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/**
 * Lightweight list for sidebars: prefer meta.json; never full-scan transcripts.
 * Returns newest-first when updatedAt is known.
 */
export function listConversationIndex(): ConversationMeta[] {
  const ids = listConversations();
  const rows: ConversationMeta[] = [];
  for (const id of ids) {
    const meta = loadConversationMeta(id);
    if (meta) {
      rows.push(meta);
      continue;
    }
    // Fallback: directory mtime only (no transcript parse).
    try {
      const dir = conversationDir(id);
      const st = fs.statSync(dir);
      rows.push({
        id,
        title: id,
        updatedAt: Math.round(st.mtimeMs),
        createdAt: Math.round(st.birthtimeMs || st.mtimeMs),
      });
    } catch {
      rows.push({ id, title: id, updatedAt: 0, createdAt: 0 });
    }
  }
  rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return rows;
}

/** Expose the base directory (useful for tests / cleanup). */
export function conversationsBaseDir(): string {
  return path.join(penglaiHome(), "conversations");
}
