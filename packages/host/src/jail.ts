/**
 * Workspace Path Jail
 *
 * Validates that every file operation stays inside the workspace root.
 * This is the path boundary for file tools (read/write/edit). Process
 * isolation is a separate ExecutionBroker responsibility.
 *
 * Threat model (see docs/0.4/01-CONSTITUTION.md §3.2 Boundary):
 *   - ".." traversal escaping the workspace
 *   - absolute paths pointing outside
 *   - symlinks that resolve outside the workspace
 *   - case-sensitivity tricks on Windows / macOS
 *
 * Strategy: resolve both root and target through fs.realpath (collapsing
 * symlinks and ".."), then verify the resolved target is the root itself or
 * lives beneath it with a path-separator boundary.
 */

import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Normalize a path into a comparable, case-normalized, forward-slash form.
 * Windows is case-insensitive (drive letters + paths); other platforms are
 * compared case-sensitively. The `\\?\` extended-length prefix that Node may
 * return from realpathSync on Windows is stripped so comparisons line up.
 */
function toComparable(p: string): string {
  let norm = p;
  if (norm.startsWith("\\\\?\\UNC\\")) {
    norm = "\\\\" + norm.slice(8);
  } else if (norm.startsWith("\\\\?\\")) {
    norm = norm.slice(4);
  }
  norm = norm.replace(/\\/g, "/");
  if (process.platform === "win32") {
    norm = norm.toLowerCase();
  }
  return norm;
}

/**
 * realpath the workspace root. The root is expected to exist; if for some
 * reason it does not, fall back to a normalized absolute path so callers still
 * get a deterministic value (and the containment check remains conservative).
 */
function realpathRoot(rootPath: string): string {
  try {
    return fs.realpathSync(rootPath);
  } catch {
    return path.resolve(rootPath);
  }
}

/**
 * realpath a target that may not yet exist (e.g. a file about to be written).
 * Walks up to the nearest existing ancestor, realpaths it (collapsing any
 * symlinks), then re-appends the non-existent tail. This means a symlinked
 * directory pointing outside the workspace is resolved to its real location
 * and correctly rejected.
 */
function realpathTarget(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    let existing = target;
    const tail: string[] = [];
    while (true) {
      try {
        existing = fs.realpathSync(existing);
        break;
      } catch {
        tail.unshift(path.basename(existing));
        const parent = path.dirname(existing);
        if (parent === existing) {
          // Reached the filesystem root without finding an existing ancestor.
          existing = parent;
          break;
        }
        existing = parent;
      }
    }
    return tail.length === 0 ? existing : path.join(existing, ...tail);
  }
}

/**
 * Boolean containment check.
 *
 * @param rootPath   absolute workspace root (must exist)
 * @param targetPath path to test; may be relative (resolved against rootPath)
 *                   or absolute
 * @returns true iff the resolved real path of target is root or beneath it
 */
export function isWithinWorkspace(rootPath: string, targetPath: string): boolean {
  const root = realpathRoot(rootPath);
  const absTarget = path.resolve(rootPath, targetPath);
  const target = realpathTarget(absTarget);

  const rootCmp = toComparable(root);
  const targetCmp = toComparable(target);

  // Exact match (target IS the root) or beneath with a separator boundary
  // so that "/workspace-evil" is NOT treated as inside "/workspace".
  return targetCmp === rootCmp || targetCmp.startsWith(rootCmp + "/");
}

/**
 * Throw a `policy_denied`-style error if targetPath escapes the workspace.
 */
export function assertInWorkspace(rootPath: string, targetPath: string): void {
  if (!isWithinWorkspace(rootPath, targetPath)) {
    throw new Error(
      `path escapes workspace: ${targetPath} (root: ${rootPath})`,
    );
  }
}

/**
 * Resolve a (possibly relative) path against the workspace root and validate
 * it stays inside. Returns the absolute, workspace-rooted path.
 */
export function resolveInWorkspace(rootPath: string, relativePath: string): string {
  const resolved = path.resolve(rootPath, relativePath);
  assertInWorkspace(rootPath, resolved);
  return resolved;
}
