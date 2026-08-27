import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { PenglaiError, readExactRegularFile } from "@penglai/contracts";

export const DATA_CATEGORIES = [
  "cache",
  "settings",
  "dsh",
  "im",
  "credentials",
  "asr-models",
  "tts-models",
  "local-voices",
  "voice-temp",
  "context-indexes",
  "memory",
  "budget",
  "companion",
] as const;

export type DataCategory = (typeof DATA_CATEGORIES)[number];

export interface ManagedDataLayout {
  userData: string;
  cacheRoot: string;
  logsRoot?: string;
}

export interface DeletionPlan {
  operationId: string;
  categories: DataCategory[];
  paths: string[];
  targetCategories: DataCategory[];
  includeCredentials: boolean;
  includeSensitive: boolean;
}

export interface DeletionTargetSnapshot {
  category: DataCategory;
  path: string;
  exists: boolean;
  type: "absent" | "file" | "directory";
  entryCount: number;
  totalBytes: number;
  owner: string;
  device: string;
  inode: string;
  treeSha256: string;
}

export interface DeletionPreview {
  schema: 1;
  operationId: string;
  categories: DataCategory[];
  createdAt: number;
  expiresAt: number;
  targets: DeletionTargetSnapshot[];
  includeCredentials: boolean;
  includeSensitive: boolean;
}

export interface DeletionInspectionOptions {
  platform?: NodeJS.Platform;
  now?: () => number;
  reparseProbe?: (path: string) => boolean;
  ownerProbe?: (path: string, stat: Stats) => string;
  batchTreeProbe?: (root: string, paths: readonly string[]) => string;
  dataLayout?: ManagedDataLayout;
}

export const SENSITIVE_CATEGORIES = ["credentials", "local-voices", "memory"] as const;

export function categoryPath(userData: string, category: DataCategory): string {
  switch (category) {
    case "cache":
      return resolve(userData, "cache");
    case "settings":
      return resolve(userData, "dsh-home", "settings.yaml");
    case "dsh":
      return resolve(userData, "dsh-home");
    case "im":
      return resolve(userData, "im");
    case "credentials":
      return resolve(userData, "dsh-home", ".credentials.yaml");
    case "asr-models":
      return resolve(userData, "voice", "models", "asr");
    case "tts-models":
      return resolve(userData, "voice", "models", "moss-tts");
    case "local-voices":
      return resolve(userData, "voice", "local-voices");
    case "voice-temp":
      return resolve(userData, "voice", "temp");
    case "context-indexes":
      return resolve(userData, "context");
    case "memory":
      return resolve(userData, "memory");
    case "budget":
      return resolve(userData, "budget");
    case "companion":
      return resolve(userData, "companion");
    default: {
      const _never: never = category;
      throw new PenglaiError("INVALID_INPUT", `unknown data category ${_never}`);
    }
  }
}

export function categoryPaths(
  userData: string,
  category: DataCategory,
  layout?: ManagedDataLayout,
): string[] {
  if (!layout) return [categoryPath(userData, category)];
  if (resolve(layout.userData) !== resolve(userData)) {
    throw new PenglaiError("SECURITY_POLICY", "managed data layout userData mismatch");
  }
  const root = resolve(userData);
  const dshHome = resolve(root, "dsh-home");
  switch (category) {
    case "cache":
      return [...new Set([
        resolve(layout.cacheRoot),
        ...(layout.logsRoot ? [resolve(layout.logsRoot)] : []),
      ])];
    case "settings":
      return [
        resolve(dshHome, "settings.yaml"),
        resolve(dshHome, "cordis.patch.yml"),
        resolve(root, "onboarding"),
        resolve(root, "plugins", "desired.json"),
        resolve(root, "Preferences"),
        resolve(root, "Local State"),
      ];
    case "dsh":
      return [
        resolve(dshHome, "storages"),
        resolve(dshHome, "attachments"),
        resolve(root, "profiles"),
        resolve(root, "plugins", "inventory-snapshot.json"),
        resolve(root, "plugins", "workspace-protection.json"),
        resolve(root, "schema.json"),
      ];
    case "memory":
      return [resolve(root, "memory"), resolve(dshHome, "skills")];
    default:
      return [categoryPath(root, category)];
  }
}

const FORBIDDEN = [
  /^\/$/,
  /^\/Users$/,
  /^\/home$/,
  /^[A-Za-z]:\\?$/,
];

function pathInsideOrEqual(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function pathsOverlap(a: string, b: string): boolean {
  return pathInsideOrEqual(a, b) || pathInsideOrEqual(b, a);
}

export function assertSafeDeletePath(
  path: string,
  userDataRoot: string,
  workspaceRoots: string[],
  legacyRoots: string[],
  managedRoots: string[] = [userDataRoot],
): void {
  if (!path || !isAbsolute(path)) throw new PenglaiError("SECURITY_POLICY", "delete path must be absolute");
  const resolved = resolve(path);
  if (FORBIDDEN.some((re) => re.test(resolved))) throw new PenglaiError("SECURITY_POLICY", "refuses root/home/drive");
  if (resolved === "/" || resolved === resolve(process.env.HOME ?? "/no-home")) {
    throw new PenglaiError("SECURITY_POLICY", "refuses home");
  }
  for (const ws of workspaceRoots) {
    if (pathsOverlap(resolved, ws)) {
      throw new PenglaiError("SECURITY_POLICY", "workspace never deleted");
    }
  }
  for (const legacy of legacyRoots) {
    if (pathsOverlap(resolved, legacy)) {
      throw new PenglaiError("SECURITY_POLICY", "legacy never deleted");
    }
  }
  if (!managedRoots.some((root) => pathInsideOrEqual(resolved, root))) {
    throw new PenglaiError("SECURITY_POLICY", "path outside managed data roots");
  }
  try {
    const st = lstatSync(resolved);
    if (st.isSymbolicLink()) throw new PenglaiError("SECURITY_POLICY", "symlink refused");
  } catch (err) {
    if (err instanceof PenglaiError) throw err;
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new PenglaiError(
        "SECURITY_POLICY",
        `delete path inspection failed: ${(err as NodeJS.ErrnoException).code ?? "UNKNOWN"}`,
      );
    }
  }
}

export function buildDeletionPlan(input: {
  operationId: string;
  categories: DataCategory[];
  userData: string;
  confirmCredentials: boolean;
  confirmSensitive?: boolean;
  dataLayout?: ManagedDataLayout;
}): DeletionPlan {
  if (!input.operationId || new Set(input.categories).size !== input.categories.length) {
    throw new PenglaiError("INVALID_INPUT", "deletion operation and categories must be unique");
  }
  if (input.categories.includes("credentials") && !input.confirmCredentials) {
    throw new PenglaiError("SECURITY_POLICY", "credentials require second confirm");
  }
  const sensitive = input.categories.filter((c) => (SENSITIVE_CATEGORIES as readonly string[]).includes(c));
  const nonCredentialSensitive = sensitive.filter((c) => c !== "credentials");
  if (nonCredentialSensitive.length && !input.confirmSensitive) {
    throw new PenglaiError("SECURITY_POLICY", "sensitive memory/voice categories require second confirm");
  }
  const targets = input.categories.flatMap((category) =>
    categoryPaths(input.userData, category, input.dataLayout).map((path) => ({ category, path })),
  );
  const paths = targets.map((target) => target.path);
  if (paths.some((p) => resolve(p) === resolve(input.userData))) {
    throw new PenglaiError("SECURITY_POLICY", "data category must not resolve to whole userData");
  }
  for (let i = 0; i < paths.length; i += 1) {
    for (let j = i + 1; j < paths.length; j += 1) {
      const a = resolve(paths[i]!);
      const b = resolve(paths[j]!);
      const bInsideA = relative(a, b);
      const aInsideB = relative(b, a);
      if (
        a === b ||
        (Boolean(bInsideA) && !bInsideA.startsWith("..") && !isAbsolute(bInsideA)) ||
        (Boolean(aInsideB) && !aInsideB.startsWith("..") && !isAbsolute(aInsideB))
      ) {
        throw new PenglaiError("SECURITY_POLICY", "overlapping delete categories refused");
      }
    }
  }
  return {
    operationId: input.operationId,
    categories: input.categories,
    paths,
    targetCategories: targets.map((target) => target.category),
    includeCredentials: input.categories.includes("credentials"),
    includeSensitive: sensitive.length > 0,
  };
}

export function detectLegacy(root: string): { present: boolean; version?: string; size?: number } {
  if (!existsSync(root)) return { present: false };
  const st = statSync(root);
  if (!st.isDirectory()) return { present: true, size: st.size };
  let version: string | undefined;
  for (const name of ["version", "VERSION", "app-version.txt"]) {
    const file = resolve(root, name);
    try {
      const bytes = readExactRegularFile(file, 4096);
      version = bytes.toString("utf8").trim().slice(0, 32);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue;
    }
  }
  return { present: true, ...(version ? { version } : {}), size: st.size };
}

export function defaultUninstallPlan(appRoot: string, updateCache: string): {
  categories: ["app", "update-cache"];
  preserveUserData: true;
  paths: string[];
} {
  return {
    categories: ["app", "update-cache"],
    preserveUserData: true,
    paths: [appRoot, updateCache],
  };
}

function defaultOwner(_path: string, stat: Stats): string {
  return `uid:${String(stat.uid)}`;
}

function inspectTarget(
  path: string,
  category: DataCategory,
  opts: DeletionInspectionOptions = {},
): DeletionTargetSnapshot {
  const target = resolve(path);
  let root: Stats;
  try {
    root = lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        category,
        path: target,
        exists: false,
        type: "absent",
        entryCount: 0,
        totalBytes: 0,
        owner: "absent",
        device: "absent",
        inode: "absent",
        treeSha256: createHash("sha256").update("absent", "utf8").digest("hex"),
      };
    }
    throw new PenglaiError(
      "SECURITY_POLICY",
      `delete target inspection failed: ${(error as NodeJS.ErrnoException).code ?? "UNKNOWN"}`,
    );
  }
  const ownerProbe = opts.ownerProbe ?? defaultOwner;
  const expectedOwner = opts.batchTreeProbe ? "" : ownerProbe(target, root);
  const rootDevice = String(root.dev);
  const facts: Array<{
    current: string;
    rel: string;
    type: string;
    size: number;
    dev: string;
    ino: string;
    mtimeMs: number;
  }> = [];
  let totalBytes = 0;
  const walk = (current: string, rel: string): void => {
    let stat: Stats;
    try {
      stat = lstatSync(current);
    } catch (error) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        `delete tree changed during inspection: ${(error as NodeJS.ErrnoException).code ?? "UNKNOWN"}`,
      );
    }
    if (stat.isSymbolicLink() || (!opts.batchTreeProbe && opts.reparseProbe?.(current))) {
      throw new PenglaiError("SECURITY_POLICY", "symlink/junction/reparse point refused");
    }
    if (String(stat.dev) !== rootDevice) {
      throw new PenglaiError("SECURITY_POLICY", "mounted filesystem boundary refused");
    }
    if (!opts.batchTreeProbe) {
      const owner = ownerProbe(current, stat);
      if (!owner || owner !== expectedOwner) {
        throw new PenglaiError("SECURITY_POLICY", "delete tree owner mismatch");
      }
    }
    const type = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
    if (type === "other") throw new PenglaiError("SECURITY_POLICY", "special filesystem object refused");
    totalBytes += stat.isFile() ? stat.size : 0;
    facts.push({
      current,
      rel,
      type,
      size: stat.size,
      dev: String(stat.dev),
      ino: String(stat.ino),
      mtimeMs: Math.trunc(stat.mtimeMs),
    });
    if (stat.isDirectory()) {
      for (const name of readdirSync(current).sort()) {
        walk(resolve(current, name), rel ? `${rel}/${name}` : name);
      }
    }
  };
  walk(target, "");
  const verifiedOwner = opts.batchTreeProbe
    ? opts.batchTreeProbe(target, facts.map((fact) => fact.current))
    : expectedOwner;
  if (!verifiedOwner) {
    throw new PenglaiError("SECURITY_POLICY", "delete tree owner missing");
  }
  const rows = facts.map((fact) => [
    fact.rel,
    fact.type,
    fact.size,
    fact.dev,
    fact.ino,
    fact.mtimeMs,
    verifiedOwner,
  ].join("\u0000"));
  return {
    category,
    path: target,
    exists: true,
    type: root.isDirectory() ? "directory" : "file",
    entryCount: rows.length,
    totalBytes,
    owner: verifiedOwner,
    device: String(root.dev),
    inode: String(root.ino),
    treeSha256: createHash("sha256").update(rows.join("\n"), "utf8").digest("hex"),
  };
}

export interface StorageCategoryInventory {
  category: DataCategory;
  targets: DeletionTargetSnapshot[];
  totalBytes?: number;
  entryCount?: number;
  deletable: boolean;
  inspectionError?: string;
  sensitive: boolean;
}

export interface StorageInventory {
  schema: 1;
  categories: StorageCategoryInventory[];
  workspaceRoots: string[];
  legacy: Array<{ path: string; present: boolean; version?: string; size?: number }>;
  generatedAt: string;
}

export function inspectStorageInventory(
  layout: ManagedDataLayout,
  workspaceRoots: string[],
  legacyRoots: string[],
  opts: DeletionInspectionOptions = {},
): StorageInventory {
  const platform = opts.platform ?? process.platform;
  if (platform === "win32" && (!opts.ownerProbe || !opts.reparseProbe)) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "Windows inventory requires native owner and reparse-point probes",
    );
  }
  const managedRoots = [
    resolve(layout.userData),
    resolve(layout.cacheRoot),
    ...(layout.logsRoot ? [resolve(layout.logsRoot)] : []),
  ];
  return {
    schema: 1,
    categories: DATA_CATEGORIES.map((category) => {
      try {
        const targets = categoryPaths(layout.userData, category, layout).map((path) => {
          assertSafeDeletePath(path, layout.userData, workspaceRoots, legacyRoots, managedRoots);
          return inspectTarget(path, category, { ...opts, dataLayout: layout });
        });
        return {
          category,
          targets,
          totalBytes: targets.reduce((sum, target) => sum + target.totalBytes, 0),
          entryCount: targets.reduce((sum, target) => sum + target.entryCount, 0),
          deletable: true,
          sensitive: (SENSITIVE_CATEGORIES as readonly string[]).includes(category),
        };
      } catch (error) {
        return {
          category,
          targets: [],
          deletable: false,
          inspectionError: error instanceof PenglaiError ? error.errorClass : "INSPECTION_FAILED",
          sensitive: (SENSITIVE_CATEGORIES as readonly string[]).includes(category),
        };
      }
    }),
    workspaceRoots: workspaceRoots.map((path) => resolve(path)),
    legacy: legacyRoots.map((path) => ({ path: resolve(path), ...detectLegacy(path) })),
    generatedAt: new Date().toISOString(),
  };
}

export function previewDeletionPlan(
  plan: DeletionPlan,
  userData: string,
  workspaceRoots: string[],
  legacyRoots: string[],
  opts: DeletionInspectionOptions = {},
): DeletionPreview {
  const platform = opts.platform ?? process.platform;
  if (platform === "win32" && (!opts.ownerProbe || !opts.reparseProbe)) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "Windows deletion requires native owner and reparse-point probes",
    );
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(plan.operationId)) {
    throw new PenglaiError("INVALID_INPUT", "invalid deletion operation id");
  }
  if (plan.targetCategories.length !== plan.paths.length) {
    throw new PenglaiError("STORE_CORRUPT", "deletion plan shape mismatch");
  }
  const expectedTargets = plan.categories.flatMap((category) =>
    categoryPaths(userData, category, opts.dataLayout).map((path) => ({ category, path })),
  );
  if (expectedTargets.length !== plan.paths.length) {
    throw new PenglaiError("STORE_CORRUPT", "deletion plan target count mismatch");
  }
  const managedRoots = [
    resolve(userData),
    ...(opts.dataLayout
      ? [
          resolve(opts.dataLayout.cacheRoot),
          ...(opts.dataLayout.logsRoot ? [resolve(opts.dataLayout.logsRoot)] : []),
        ]
      : []),
  ];
  for (let i = 0; i < plan.paths.length; i += 1) {
    if (
      plan.targetCategories[i] !== expectedTargets[i]!.category ||
      resolve(plan.paths[i]!) !== resolve(expectedTargets[i]!.path)
    ) {
      throw new PenglaiError("SECURITY_POLICY", "deletion plan path is not category-derived");
    }
    assertSafeDeletePath(plan.paths[i]!, userData, workspaceRoots, legacyRoots, managedRoots);
  }
  const createdAt = (opts.now ?? Date.now)();
  return {
    schema: 1,
    operationId: plan.operationId,
    categories: [...plan.categories],
    createdAt,
    expiresAt: createdAt + 5 * 60_000,
    targets: plan.paths.map((path, index) => inspectTarget(path, plan.targetCategories[index]!, opts)),
    includeCredentials: plan.includeCredentials,
    includeSensitive: plan.includeSensitive,
  };
}

function snapshotsEqual(a: DeletionTargetSnapshot, b: DeletionTargetSnapshot): boolean {
  return a.category === b.category &&
    a.path === b.path &&
    a.exists === b.exists &&
    a.type === b.type &&
    a.entryCount === b.entryCount &&
    a.totalBytes === b.totalBytes &&
    a.owner === b.owner &&
    a.device === b.device &&
    a.inode === b.inode &&
    a.treeSha256 === b.treeSha256;
}

function removeVerifiedTargets(
  preview: DeletionPreview,
  userData: string,
  workspaceRoots: string[],
  legacyRoots: string[],
  opts: DeletionInspectionOptions = {},
  onDeleted?: (path: string) => void,
): { deleted: string[] } {
  const deleted: string[] = [];
  const managedRoots = [
    resolve(userData),
    ...(opts.dataLayout
      ? [
          resolve(opts.dataLayout.cacheRoot),
          ...(opts.dataLayout.logsRoot ? [resolve(opts.dataLayout.logsRoot)] : []),
        ]
      : []),
  ];
  for (const expected of preview.targets) {
    assertSafeDeletePath(expected.path, userData, workspaceRoots, legacyRoots, managedRoots);
    const actual = inspectTarget(expected.path, expected.category, opts);
    if (!snapshotsEqual(expected, actual)) {
      throw new PenglaiError("SECURITY_POLICY", "delete target changed after confirmation");
    }
    if (!actual.exists) continue;
    try {
      rmSync(actual.path, { recursive: actual.type === "directory", force: false, maxRetries: 0 });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new PenglaiError("SECURITY_POLICY", `locked or permission stop: ${code ?? "UNKNOWN"}`);
    }
    if (existsSync(actual.path)) {
      throw new PenglaiError("SECURITY_POLICY", "delete postcondition failed");
    }
    deleted.push(actual.path);
    onDeleted?.(actual.path);
  }
  return { deleted };
}

function writeDeletionJournal(
  dir: string,
  record: Record<string, unknown>,
): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dest = resolve(dir, "deletion-journal.json");
  const tmp = resolve(dir, `.deletion-journal.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
  renameSync(tmp, dest);
}

export class DeletionAuthorizer {
  readonly #pending = new Map<string, DeletionPreview>();

  constructor(
    readonly userData: string,
    readonly workspaceRoots: string[],
    readonly legacyRoots: string[],
    readonly journalDir: string,
    readonly options: DeletionInspectionOptions = {},
  ) {}

  prepare(plan: DeletionPlan): DeletionPreview {
    const preview = previewDeletionPlan(
      plan,
      this.userData,
      this.workspaceRoots,
      this.legacyRoots,
      this.options,
    );
    this.#pending.set(preview.operationId, preview);
    writeDeletionJournal(this.journalDir, {
      schema: 1,
      operationId: preview.operationId,
      state: "awaiting-confirmation",
      categories: preview.categories,
      targets: preview.targets,
      createdAt: preview.createdAt,
      expiresAt: preview.expiresAt,
    });
    return preview;
  }

  cancel(operationId: string): void {
    const preview = this.#pending.get(operationId);
    this.#pending.delete(operationId);
    if (!preview) throw new PenglaiError("SECURITY_POLICY", "unknown or consumed deletion capability");
    writeDeletionJournal(this.journalDir, {
      schema: 1,
      operationId,
      state: "cancelled",
      categories: preview.categories,
      at: (this.options.now ?? Date.now)(),
    });
  }

  execute(operationId: string): { deleted: string[] } {
    const preview = this.#pending.get(operationId);
    this.#pending.delete(operationId);
    if (!preview) throw new PenglaiError("SECURITY_POLICY", "unknown or consumed deletion capability");
    const now = (this.options.now ?? Date.now)();
    if (now > preview.expiresAt) {
      writeDeletionJournal(this.journalDir, { schema: 1, operationId, state: "expired", at: now });
      throw new PenglaiError("SECURITY_POLICY", "deletion confirmation expired");
    }
    const deleted: string[] = [];
    writeDeletionJournal(this.journalDir, { schema: 1, operationId, state: "executing", deleted });
    try {
      const result = removeVerifiedTargets(
        preview,
        this.userData,
        this.workspaceRoots,
        this.legacyRoots,
        this.options,
        (path) => {
          deleted.push(path);
          writeDeletionJournal(this.journalDir, { schema: 1, operationId, state: "executing", deleted });
        },
      );
      writeDeletionJournal(this.journalDir, { schema: 1, operationId, state: "committed", deleted: result.deleted });
      return result;
    } catch (error) {
      writeDeletionJournal(this.journalDir, { schema: 1, operationId, state: "stopped", deleted });
      throw error;
    }
  }
}

export function macOsUninstallGuide(input: {
  appPath: string;
  userData: string;
  selected?: DeletionPreview;
}): { platform: "darwin"; steps: string[]; exactPaths: string[]; preservesWorkspace: true } {
  if (!isAbsolute(input.appPath) || !isAbsolute(input.userData)) {
    throw new PenglaiError("INVALID_INPUT", "macOS uninstall paths must be absolute");
  }
  return {
    platform: "darwin",
    steps: [
      "Export any data you want to keep.",
      "Stop Penglai-owned services.",
      "Delete only the confirmed data categories below.",
      `Move ${resolve(input.appPath)} to Trash in Finder.`,
    ],
    exactPaths: input.selected?.targets.map((target) => target.path) ?? [],
    preservesWorkspace: true,
  };
}

export function executeDeletionPlan(
  plan: DeletionPlan,
  userData: string,
  workspaceRoots: string[],
  legacyRoots: string[],
  opts: DeletionInspectionOptions = {},
): { deleted: string[] } {
  const preview = previewDeletionPlan(plan, userData, workspaceRoots, legacyRoots, opts);
  return removeVerifiedTargets(preview, userData, workspaceRoots, legacyRoots, opts);
}
