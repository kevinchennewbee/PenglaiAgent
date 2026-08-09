/**
 * Immutable execution authority captured when an AgentKernel episode starts.
 *
 * The snapshot is deliberately small and server-derived. It is re-read before
 * queueing work into a live kernel and before every Pi tool call so a kernel
 * cannot keep using an old project jail after its task, root, trust, or
 * permission dial changes.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type EpisodePermissionMode = "confirm" | "auto_edit" | "full" | "plan";

export interface EpisodeAuthoritySnapshot {
  kind: "chat" | "task";
  conversationId: string | null;
  runId: string | null;
  taskId: string | null;
  projectId: string | null;
  workspaceRoot: string;
  /** Filesystem identity of the canonical directory (`dev:ino`). */
  workspaceIdentity: string;
  trusted: boolean;
  permissionMode: EpisodePermissionMode;
}

export const EPISODE_AUTHORITY_CHANGED = "authority_changed" as const;

export class EpisodeAuthorityError extends Error {
  readonly code = EPISODE_AUTHORITY_CHANGED;

  constructor(message = "episode authority changed; the previous kernel was revoked") {
    super(message);
    this.name = "EpisodeAuthorityError";
  }
}

/**
 * Resolve one execution root without following a symlink at the declared root
 * and bind it to a stable directory identity. Re-running this before every
 * tool call detects rename/replacement even when the lexical path is reused.
 */
export function resolveWorkspaceAuthority(rootPath: string): {
  workspaceRoot: string;
  workspaceIdentity: string;
} {
  try {
    const declared = path.resolve(rootPath);
    const declaredStat = fs.lstatSync(declared, { bigint: true });
    if (declaredStat.isSymbolicLink()) {
      throw new Error("declared workspace root is a symbolic link");
    }
    if (!declaredStat.isDirectory()) {
      throw new Error("declared workspace root is not a directory");
    }
    const workspaceRoot = fs.realpathSync(declared);
    const canonicalStat = fs.lstatSync(workspaceRoot, { bigint: true });
    if (canonicalStat.isSymbolicLink() || !canonicalStat.isDirectory()) {
      throw new Error("canonical workspace root is not a real directory");
    }
    return {
      workspaceRoot,
      workspaceIdentity: `${canonicalStat.dev}:${canonicalStat.ino}`,
    };
  } catch (error) {
    if (error instanceof EpisodeAuthorityError) throw error;
    throw new EpisodeAuthorityError(
      `workspace authority is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function sameEpisodeAuthority(
  expected: EpisodeAuthoritySnapshot,
  current: EpisodeAuthoritySnapshot,
): boolean {
  return (
    expected.kind === current.kind &&
    expected.conversationId === current.conversationId &&
    expected.runId === current.runId &&
    expected.taskId === current.taskId &&
    expected.projectId === current.projectId &&
    expected.workspaceRoot === current.workspaceRoot &&
    expected.workspaceIdentity === current.workspaceIdentity &&
    expected.trusted === current.trusted &&
    expected.permissionMode === current.permissionMode
  );
}
