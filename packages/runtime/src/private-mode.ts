import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  type Stats,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { posixCredentialModes } from "./permissions.js";

export const PRIVATE_MODE_WALK_LIMIT = 8_000;

export type PrivateTreeId =
  | "user-root"
  | "dsh-home"
  | "vault"
  | "grant"
  | "artifact"
  | "im"
  | "backup";

export type PrivateTreePolicy = "root-only" | "secret" | "file";

export interface PrivateModeTree {
  id: PrivateTreeId;
  relative: string;
  policy: PrivateTreePolicy;
}

export const PRIVATE_MODE_TREES: readonly PrivateModeTree[] = Object.freeze([
  { id: "user-root", relative: ".", policy: "root-only" },
  { id: "dsh-home", relative: "dsh-home", policy: "root-only" },
  { id: "vault", relative: "dsh-home/.credentials.yaml", policy: "file" },
  { id: "grant", relative: "plugins", policy: "secret" },
  { id: "artifact", relative: "objects", policy: "secret" },
  { id: "im", relative: "im", policy: "secret" },
  { id: "backup", relative: ".penglai-backup", policy: "secret" },
]);

export interface PrivateModeReport {
  platform: NodeJS.Platform;
  posixModesApplied: boolean;
  trees: Array<{ id: PrivateTreeId; existed: boolean; entries: number }>;
}

function fail(id: PrivateTreeId, reason: string): never {
  throw new PenglaiError("SECURITY_POLICY", `private tree ${id} ${reason}`);
}

function existsNoFollow(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw error;
  }
}

function lstatIdentity(path: string, id: PrivateTreeId): Stats {
  let st: Stats;
  try {
    st = lstatSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") fail(id, "missing after create");
    throw error;
  }
  if (st.isSymbolicLink()) fail(id, "is a symlink");
  return st;
}

function assertUnchanged(path: string, id: PrivateTreeId, before: Stats): Stats {
  const after = lstatIdentity(path, id);
  if (after.dev !== before.dev || after.ino !== before.ino) fail(id, "changed during mode race");
  if (after.isSymbolicLink()) fail(id, "is a symlink");
  return after;
}

function applyDirMode(path: string, id: PrivateTreeId, posix: boolean): void {
  const before = lstatIdentity(path, id);
  if (!before.isDirectory()) fail(id, "is not a directory");
  if (posix) chmodSync(path, posixCredentialModes().dir);
  assertUnchanged(path, id, before);
}

function applyFileMode(path: string, id: PrivateTreeId, posix: boolean): void {
  const before = lstatIdentity(path, id);
  if (!before.isFile()) fail(id, "is not a regular file");
  if (posix) chmodSync(path, posixCredentialModes().file);
  assertUnchanged(path, id, before);
}

function ensureDirectory(path: string, id: PrivateTreeId, posix: boolean): void {
  if (!existsNoFollow(path)) {
    mkdirSync(path, { recursive: true, mode: posixCredentialModes().dir });
  }
  applyDirMode(path, id, posix);
}

function walkSecretTree(root: string, id: PrivateTreeId, posix: boolean): number {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    const st = lstatIdentity(current, id);
    seen += 1;
    if (seen > PRIVATE_MODE_WALK_LIMIT) fail(id, "exceeded walk limit");
    if (st.isDirectory()) {
      if (posix) chmodSync(current, posixCredentialModes().dir);
      assertUnchanged(current, id, st);
      for (const name of readdirSync(current)) {
        if (name === "." || name === "..") continue;
        stack.push(join(current, name));
      }
      continue;
    }
    if (!st.isFile()) fail(id, "contains a special filesystem object");
    if (posix) chmodSync(current, posixCredentialModes().file);
    assertUnchanged(current, id, st);
  }
  return seen;
}

export function privateModeTrees(userRoot: string, dshHome?: string): Array<PrivateModeTree & { path: string }> {
  const root = resolve(userRoot);
  const home = resolve(dshHome ?? join(root, "dsh-home"));
  return PRIVATE_MODE_TREES.map((tree) => ({
    ...tree,
    path:
      tree.id === "dsh-home"
        ? home
        : tree.id === "vault"
          ? join(home, ".credentials.yaml")
          : tree.relative === "."
            ? root
            : resolve(root, tree.relative),
  }));
}

export function convergePrivatePosixModes(
  user: { root: string; dshHome?: string },
  platform: NodeJS.Platform = process.platform,
): PrivateModeReport {
  const posix = platform !== "win32";
  const trees = privateModeTrees(user.root, user.dshHome);
  const report: PrivateModeReport = {
    platform,
    posixModesApplied: posix,
    trees: [],
  };
  for (const tree of trees) {
    if (tree.policy === "file") {
      if (!existsNoFollow(tree.path)) {
        report.trees.push({ id: tree.id, existed: false, entries: 0 });
        continue;
      }
      const parent = dirname(tree.path);
      ensureDirectory(parent, tree.id, posix);
      applyFileMode(tree.path, tree.id, posix);
      report.trees.push({ id: tree.id, existed: true, entries: 1 });
      continue;
    }
    const existed = existsNoFollow(tree.path);
    ensureDirectory(tree.path, tree.id, posix);
    if (tree.policy === "secret") {
      report.trees.push({ id: tree.id, existed, entries: walkSecretTree(tree.path, tree.id, posix) });
      continue;
    }
    report.trees.push({ id: tree.id, existed, entries: 1 });
  }
  return report;
}
