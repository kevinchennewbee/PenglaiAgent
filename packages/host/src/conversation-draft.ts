/**
 * Conversation-scoped floating workspace resolution.
 *
 * The Host owns dataDir/drafts. Every unanchored conversation receives one
 * direct child and no caller-supplied path participates in the decision.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ensurePrivateDirectory } from "./security/private-file.js";

const SAFE_CONVERSATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

function comparablePath(value: string): string {
  // Preserve case even on case-insensitive filesystems: conversation ids are
  // case-sensitive identifiers, so `Conv_A` and `conv_a` must never converge
  // on the same pre-existing directory.
  return path.normalize(value);
}

function isSamePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function establishOwnedDirectory(directory: string, label: string): string {
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink: ${directory}`);
  }
  ensurePrivateDirectory(directory);
  const resolved = fs.realpathSync(directory);
  if (!isSamePath(resolved, directory) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`${label} is not an isolated directory: ${directory}`);
  }
  return resolved;
}

/**
 * Establish the only Host-owned write root exposed to a floating conversation.
 *
 * dataDir itself may be an intentional symlink (for example to another local
 * volume), so it is canonicalized first. The Host-owned `drafts` child and
 * the conversation child must both be real directories, never symlinks.
 */
export function resolveConversationDraftRoot(
  dataDir: string,
  conversationId: string | null | undefined,
): string | null {
  const id = conversationId?.trim() ?? "";
  if (!id) return null;
  if (!SAFE_CONVERSATION_ID.test(id)) {
    throw new Error(
      `invalid conversationId for draft isolation: ${JSON.stringify(conversationId)}`,
    );
  }

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const canonicalDataDir = fs.realpathSync(dataDir);
  ensurePrivateDirectory(canonicalDataDir);
  const draftsRoot = establishOwnedDirectory(
    path.join(canonicalDataDir, "drafts"),
    "conversation drafts root",
  );
  return establishOwnedDirectory(
    path.join(draftsRoot, id),
    "conversation draft root",
  );
}
