import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { PenglaiError, readExactRegularFile } from "@penglai/contracts";
import {
  clearIdentity,
  killIdentity,
  migrateUserSchema,
  readIdentity,
  readProcessPgid,
  readProcessStartMs,
  reapDshOrphans,
  writeIdentity,
  type ProcessIdentity,
} from "./process.js";
import {
  assertPluginPackageManifest,
  FIRST_PARTY_PLUGIN_METADATA,
  loadPluginCatalog,
  runtimePluginTarget,
} from "./plugin-catalog.js";
import { extractTarGz } from "./safe-tar.js";
import { applyWindowsCredentialAcl, readOwnedWindowsJobReport, spawnOwnedDshProcess } from "./windows-host.js";
import { writeFileAtomic } from "./permissions.js";
import {
  IDLE_SUPERVISOR_RECOVERY,
  nextSupervisorHealthDecision,
  redactSupervisorLog,
  reusableSupervisorPort,
  shouldRestartAfterExit,
  supervisorBackoffMs,
  SUPERVISOR_HEALTH_INTERVAL_MS,
  SUPERVISOR_HEALTH_TIMEOUT_MS,
  SUPERVISOR_RESTART_MAX,
  SUPERVISOR_RESTART_WINDOW_MS,
  SUPERVISOR_UNHEALTHY_KILL_GRACE_MS,
  type SupervisorFailureTrigger,
  type SupervisorRecoverySnapshot,
} from "./supervisor-policy.js";
import { evaluateInventory, type InventoryProof } from "./inventory-proof.js";
import { convergePrivatePosixModes } from "./private-mode.js";
export * from "./layout.js";
export * from "./permissions.js";
export * from "./arch-guard.js";
export * from "./scanner.js";
export * from "./update.js";
export * from "./update-flow.js";
export * from "./update-coordinator.js";
export * from "./supervisor-policy.js";
export * from "./update-backup.js";
export * from "./uninstall.js";
export * from "./windows-host.js";
export * from "./packaging.js";
export * from "./fuses.js";

export const PENGLAI_VERSION = "0.5.7";
export const PINNED_DSH = "0.1.1-rc.2";
export const PINNED_NODE = "22.22.2";
export const PINNED_ELECTRON = "43.4.0";
export const NODE_TARBALL_SHA256 = "db4b275b83736df67533529a18cc55de2549a8329ace6c7bcc68f8d22d3c9000";

function readRegularFileNoFollow(path: string): Buffer | undefined;
function readRegularFileNoFollow(path: string, encoding: "utf8"): string | undefined;
function readRegularFileNoFollow(path: string, encoding?: "utf8"): Buffer | string | undefined {
  try {
    const bytes = readExactRegularFile(path);
    return encoding === "utf8" ? bytes.toString("utf8") : bytes;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

export interface RuntimeLayout {
  appRoot: string;
  nodeBin: string;
  dshEntry: string;
  profileSeed: string;
  pluginsDir: string;
  manifestPath: string;
  officialDeepseek: string;
}

export interface UserLayout {
  root: string;
  dshHome: string;
  profileWeb: string;
  transactions: string;
  snapshots: string;
  imDb: string;
  logs: string;
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isAbsoluteRuntimePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

export function assertAbsoluteExecutable(path: string, label: string): void {
  if (!isAbsoluteRuntimePath(path)) throw new PenglaiError("SECURITY_POLICY", `${label} must be absolute`);
  if (!existsSync(path)) throw new PenglaiError("DSH_UNAVAILABLE", `${label} missing: ${path}`);
  const st = statSync(path);
  if (!st.isFile()) throw new PenglaiError("DSH_UNAVAILABLE", `${label} is not a file`);
}

export function resolveRuntimeLayout(appRoot: string, platform: "darwin" | "win32" = process.platform === "win32" ? "win32" : "darwin"): RuntimeLayout {
  const root = resolve(appRoot);
  const nodeBin =
    platform === "win32" ? join(root, "runtime", "node", "node.exe") : join(root, "runtime", "node", "bin", "node");
  return {
    appRoot: root,
    nodeBin,
    dshEntry: join(root, "runtime", "dsh", "lib", "bin.js"),
    profileSeed: join(root, "profile-seed", "web"),
    pluginsDir: join(root, "plugins"),
    manifestPath: join(root, "runtime-manifest.json"),
    officialDeepseek: join(root, "runtime", "dsh", "node_modules", "@deepseek-ai"),
  };
}

export function resolveUserLayout(userData: string): UserLayout {
  const root = resolve(userData);
  return {
    root,
    dshHome: join(root, "dsh-home"),
    profileWeb: join(root, "dsh-home", "profiles", "web"),
    transactions: join(root, "profiles", "transactions"),
    snapshots: join(root, "profiles", "snapshots"),
    imDb: join(root, "im", "penglai-im.sqlite"),
    logs: join(root, "logs"),
  };
}

export function ensurePrivateHome(user: UserLayout, appRoot?: string): void {
  for (const p of [user.root, user.dshHome, user.profileWeb, user.transactions, user.snapshots, dirname(user.imDb), user.logs]) {
    mkdirSync(p, { recursive: true, mode: 0o700 });
  }
  convergePrivatePosixModes(user);
  if (process.platform === "win32") {
    if (!appRoot) throw new PenglaiError("SECURITY_POLICY", "Windows private home requires the packaged app root");
    applyWindowsCredentialAcl(user.dshHome, { platform: "win32", appRoot });
    const yaml = join(user.dshHome, ".credentials.yaml");
    if (existsSync(yaml)) {
      applyWindowsCredentialAcl(yaml, { platform: "win32", appRoot });
    }
  }
}
export interface ManifestEntry {
  path: string;
  sha256: string;
  size: number;
}

export function verifyRuntimeManifest(layout: RuntimeLayout): { ok: true } {
  assertAbsoluteExecutable(layout.nodeBin, "embedded node");
  assertAbsoluteExecutable(layout.dshEntry, "embedded dsh");
  if (!existsSync(layout.manifestPath)) throw new PenglaiError("STORE_CORRUPT", "runtime-manifest missing");
  const man = JSON.parse(readFileSync(layout.manifestPath, "utf8")) as { files: ManifestEntry[] };
  for (const f of man.files) {
    const abs = join(layout.appRoot, f.path);
    if (!existsSync(abs)) throw new PenglaiError("STORE_CORRUPT", `missing ${f.path}`);
    const got = sha256File(abs);
    if (got !== f.sha256) throw new PenglaiError("STORE_CORRUPT", `hash mismatch ${f.path}`);
  }
  return { ok: true };
}

export function seedWebProfile(seedDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true, mode: 0o700 });
  copyDir(seedDir, destDir);
}

export function extractedPackageRoot(tmp: string): string {
  if (existsSync(join(tmp, "package.json"))) return tmp;
  if (existsSync(join(tmp, "package", "package.json"))) return join(tmp, "package");
  throw new PenglaiError("STORE_CORRUPT", "plugin tarball has no package.json");
}

export function assertPluginJsClosure(pkgDir: string, id: string): void {
  const pkgPath = join(pkgDir, "package.json");
  if (!existsSync(pkgPath)) throw new PenglaiError("STORE_CORRUPT", `${id} missing package.json`);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    main?: string;
    exports?: { "."?: string | { default?: string } };
  };
  const main = typeof pkg.main === "string" ? pkg.main : "";
  const exp = pkg.exports?.["."];
  const exported = typeof exp === "string" ? exp : exp?.default ?? "";
  if (main.includes("src/") || exported.includes("src/") || main.endsWith(".ts") || exported.endsWith(".ts")) {
    throw new PenglaiError("STORE_CORRUPT", `${id} runtime entry still points at src`);
  }
  const host = join(pkgDir, "dist", "index.js");
  if (!existsSync(host)) throw new PenglaiError("STORE_CORRUPT", `${id} missing dist/index.js`);
  const js = readFileSync(host, "utf8");
  if (js.includes("from \"../src/") || js.includes("from '../src/") || js.includes("from \"./src/") || js.includes("from './src/")) {
    throw new PenglaiError("STORE_CORRUPT", `${id} host still imports src`);
  }
  if (id === "@penglai/im") {
    // Match quoted module specs only. The esbuild ESM helper is
    // `Dynamic require of "' + x + '"`, which is not an inlined CJS require.
    const specs = [...js.matchAll(/Dynamic require of ["']([^"']+)["']/g)].map((row) => row[1]);
    if (specs.length > 0 || js.includes("form-data/lib/form_data")) {
      throw new PenglaiError("STORE_CORRUPT", `${id} host inlines Lark/axios CJS`);
    }
  }
}

export function linkOfficialDeepseek(layout: RuntimeLayout, profileDir: string): void {
  if (!existsSync(layout.officialDeepseek)) {
    throw new PenglaiError("DSH_UNAVAILABLE", "official @deepseek-ai missing from embedded DSH");
  }
  const destParent = join(profileDir, "node_modules");
  mkdirSync(destParent, { recursive: true, mode: 0o700 });
  const dest = join(destParent, "@deepseek-ai");
  if (existsSync(dest) || isSymlink(dest)) {
    const current = isSymlink(dest) ? readlinkSync(dest) : "";
    if (current && resolve(current) === resolve(layout.officialDeepseek)) return;
    rmSync(dest, { recursive: true, force: true });
  }
  // Windows directory junctions work for ordinary installed-app users without
  // Developer Mode or elevated symlink privileges. POSIX keeps a normal dir link.
  symlinkSync(layout.officialDeepseek, dest, process.platform === "win32" ? "junction" : "dir");
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function unquoteYaml(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export interface CordisPatchPlugin {
  id?: string;
  name?: string;
  disabled?: boolean;
}

function stripYamlComment(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] ?? "";
    if ((char === '"' || char === "'") && (i === 0 || line[i - 1] !== "\\")) {
      quote = quote === char ? "" : quote ? quote : char;
      continue;
    }
    if (!quote && char === "#" && (i === 0 || /\s/.test(line[i - 1] ?? ""))) return line.slice(0, i);
  }
  return line;
}

function yamlField(text: string): { key: "id" | "name" | "disabled"; value: string } | undefined {
  const colon = text.indexOf(":");
  if (colon < 1) return undefined;
  const key = text.slice(0, colon).trim();
  if (key !== "id" && key !== "name" && key !== "disabled") return undefined;
  const value = text.slice(colon + 1).trim();
  if (!value) return undefined;
  return { key, value };
}

export function parseCordisPatchPlugins(text: string): CordisPatchPlugin[] {
  const plugins: CordisPatchPlugin[] = [];
  let current: CordisPatchPlugin | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripYamlComment(rawLine);
    const trimmed = line.trimStart();
    const item = trimmed.startsWith("- ") ? yamlField(trimmed.slice(2).trimStart()) : undefined;
    if (item && item.key !== "disabled") {
      current = { [item.key]: unquoteYaml(item.value) };
      plugins.push(current);
      continue;
    }
    if (!current) continue;
    if (line.length === trimmed.length) continue;
    const named = yamlField(trimmed);
    if (!named) continue;
    const key = named.key;
    const value = unquoteYaml(named.value);
    if (key === "disabled") current.disabled = value.toLowerCase() === "true";
    else if (key === "id") current.id = value;
    else current.name = value;
  }
  return plugins;
}

export function profilePluginEnabled(patchText: string, pluginId: string): boolean {
  const short = pluginId.replace("@penglai/", "penglai-");
  const hit = parseCordisPatchPlugins(patchText).find(
    (row) =>
      row.id === short ||
      row.id === pluginId ||
      row.name === pluginId ||
      row.name === short,
  );
  return Boolean(hit && hit.disabled !== true);
}

export function installFirstPartyPlugins(
  layout: RuntimeLayout,
  destProfile: string,
  txDir: string,
  requestedIds: readonly string[] = [],
): void {
  if (!existsSync(layout.pluginsDir)) {
    throw new PenglaiError("DSH_UNAVAILABLE", "bundled plugin directory missing");
  }
  const catalog = loadPluginCatalog(
    layout.pluginsDir,
    runtimePluginTarget(),
    true,
  );
  const requested = new Set(requestedIds);
  for (const id of requested) {
    if (!catalog.entries.some((entry) => entry.id === id)) {
      throw new PenglaiError("INVALID_INPUT", `unlisted requested plugin ${id}`);
    }
  }
  const patchPath = join(destProfile, "cordis.patch.yml");
  const patchText = existsSync(patchPath) ? readFileSync(patchPath, "utf8") : "";
  const nm = join(destProfile, "node_modules", "@penglai");
  mkdirSync(nm, { recursive: true, mode: 0o700 });
  for (const entry of catalog.entries) {
    const short = entry.id.replace("@penglai/", "");
    const dest = join(nm, short);
    const shouldInstall =
      entry.defaultEnabled ||
      requested.has(entry.id) ||
      existsSync(dest) ||
      profilePluginEnabled(patchText, entry.id);
    if (!shouldInstall) continue;
    const tmp = join(txDir, `pkg-${entry.packageFile}`);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    extractTarGz(readFileSync(join(layout.pluginsDir, entry.packageFile)), tmp);
    const inner = extractedPackageRoot(tmp);
    const pkg = JSON.parse(readFileSync(join(inner, "package.json"), "utf8")) as unknown;
    assertPluginPackageManifest(pkg, entry);
    const id = entry.id;
    if (id === "@penglai/credentials-keychain" || id === "@penglai/plugin-smoke") {
      throw new PenglaiError("SECURITY_POLICY", `forbidden product package ${id}`);
    }
    assertPluginJsClosure(inner, id);
    rmSync(dest, { recursive: true, force: true });
    copyDir(inner, dest);
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function seedFreshSettings(user: UserLayout): void {
  const settings = join(user.dshHome, "settings.yaml");
  mkdirSync(user.dshHome, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(
      settings,
      ["locale:", "  preference: zh", "ui-theme:", "  preference: system", ""].join("\n"),
      { mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    readExactRegularFile(settings, 4 * 1024 * 1024);
  }
}

export function detectKeychainOverride(text: string): { required: boolean } {
  const hit =
    text.includes("@penglai/credentials-keychain") ||
    text.includes("penglai-credentials-keychain") ||
    /id:\s*penglai-credentials-keychain/.test(text);
  return { required: hit };
}

export function recordKeychainMigrationIfNeeded(user: UserLayout): void {
  const patch = join(user.profileWeb, "cordis.patch.yml");
  const pkg = join(user.profileWeb, "package.json");
  const texts = [existsSync(patch) ? readFileSync(patch, "utf8") : "", existsSync(pkg) ? readFileSync(pkg, "utf8") : ""].join(
    "\n",
  );
  const detected = detectKeychainOverride(texts);
  if (!detected.required) return;
  const marker = join(user.root, "migrations", "keychain-required.json");
  mkdirSync(dirname(marker), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(
      marker,
      JSON.stringify(
        {
          code: "CREDENTIAL_MIGRATION_REQUIRED",
          action: "re-enter",
          silentRead: false,
          silentDelete: false,
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const current = JSON.parse(readExactRegularFile(marker, 64 * 1024).toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      current.code !== "CREDENTIAL_MIGRATION_REQUIRED" ||
      current.action !== "re-enter" ||
      current.silentRead !== false ||
      current.silentDelete !== false
    ) {
      throw new PenglaiError("STORE_CORRUPT", "keychain migration marker invalid");
    }
  }
}

function removeCordisPluginBlock(patchText: string, pluginId: string): {
  text: string;
  removed: number;
} {
  const short = pluginId.replace(/^@/, "").replaceAll("/", "-");
  const endsWithNewline = patchText.endsWith("\n");
  const lines = patchText.split("\n");
  const output: string[] = [];
  let block: string[] = [];
  let removed = 0;
  const flush = (): void => {
    if (!block.length) return;
    const text = block.join("\n");
    const matches =
      text.includes(`name: "${pluginId}"`) ||
      text.includes(`name: '${pluginId}'`) ||
      text.includes(`id: ${short}`);
    if (matches) removed += 1;
    else output.push(...block);
    block = [];
  };
  for (const line of lines) {
    if (/^\s*-\s+id:\s+/.test(line)) flush();
    block.push(line);
  }
  flush();
  if (removed > 1) {
    throw new PenglaiError("STORE_CORRUPT", `${pluginId} profile entry count ${removed}`);
  }
  const next = output.join("\n");
  return {
    text: endsWithNewline && !next.endsWith("\n") ? `${next}\n` : next,
    removed,
  };
}

/**
 * 0.5.5 folds the former Context plugin into Penglai Memory. Preserve its
 * derived index under userData/context, but retire the separately loadable
 * profile package so upgraded profiles have the same one-plugin identity as a
 * fresh install.
 */
export function mergeLegacyContextIntoMemory(user: UserLayout): {
  changed: boolean;
  profileEntryRemoved: boolean;
  manifestEntryRemoved: boolean;
  packageRemoved: boolean;
  dataPreserved: true;
} {
  const profileRoot = resolve(user.profileWeb);
  if (!pathWithin(user.root, profileRoot) || profileRoot === resolve(user.root)) {
    throw new PenglaiError("SECURITY_POLICY", "legacy Context profile escaped userData");
  }
  const patchPath = join(profileRoot, "cordis.patch.yml");
  let profileEntryRemoved = false;
  const current = readRegularFileNoFollow(patchPath, "utf8");
  if (current !== undefined) {
    const next = removeCordisPluginBlock(current, "@penglai/context");
    if (next.removed === 1) {
      writeFileAtomic(patchPath, next.text, 0o600);
      profileEntryRemoved = true;
    }
  }

  const manifestPath = join(profileRoot, "package.json");
  let manifestEntryRemoved = false;
  const manifestText = readRegularFileNoFollow(manifestPath, "utf8");
  if (manifestText !== undefined) {
    const manifest = JSON.parse(manifestText) as {
      dependencies?: Record<string, string>;
    };
    if (manifest.dependencies && "@penglai/context" in manifest.dependencies) {
      delete manifest.dependencies["@penglai/context"];
      writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
      manifestEntryRemoved = true;
    }
  }

  const packagePath = join(profileRoot, "node_modules", "@penglai", "context");
  if (!pathWithin(profileRoot, packagePath) || resolve(packagePath) === profileRoot) {
    throw new PenglaiError("SECURITY_POLICY", "legacy Context package escaped profile");
  }
  const packageRemoved = existsSync(packagePath);
  if (packageRemoved) rmSync(packagePath, { recursive: true, force: false });

  const changed = profileEntryRemoved || manifestEntryRemoved || packageRemoved;
  if (changed) {
    atomicJson(join(user.root, "migrations", "context-merged-0.5.5.json"), {
      schema: 1,
      from: "@penglai/context",
      into: "@penglai/memory",
      profileEntryRemoved,
      manifestEntryRemoved,
      packageRemoved,
      dataPreserved: true,
    });
  }
  return {
    changed,
    profileEntryRemoved,
    manifestEntryRemoved,
    packageRemoved,
    dataPreserved: true,
  };
}

export function activatePrivateProfile(layout: RuntimeLayout, user: UserLayout): void {
  const marker = join(user.profileWeb, "package.json");
  if (!existsSync(marker)) {
    const id = `seed-${randomUUID()}`;
    const staging = join(user.transactions, `${id}.staging-web`);
    const backup = join(user.transactions, `${id}.pre-activation`);
    writeJournal(user, { id, phase: "staging", staging, backup });
    rmSync(staging, { recursive: true, force: true });
    rmSync(backup, { recursive: true, force: true });
    seedWebProfile(layout.profileSeed, staging);
    installFirstPartyPlugins(layout, staging, user.transactions);
    linkOfficialDeepseek(layout, staging);
    writeJournal(user, { id, phase: "activating", staging, backup });
    let movedCurrent = false;
    try {
      if (existsSync(user.profileWeb)) {
        renameSync(user.profileWeb, backup);
        movedCurrent = true;
      }
      renameSync(staging, user.profileWeb);
      writeJournal(user, { id, phase: "committed" });
      if (movedCurrent) rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      if (existsSync(user.profileWeb)) rmSync(user.profileWeb, { recursive: true, force: true });
      if (movedCurrent && existsSync(backup)) renameSync(backup, user.profileWeb);
      rmSync(staging, { recursive: true, force: true });
      writeJournal(user, { id, phase: "rolled_back" });
      throw error;
    }
  } else {
    mergeLegacyContextIntoMemory(user);
    installFirstPartyPlugins(layout, user.profileWeb, user.transactions);
  }
  linkOfficialDeepseek(layout, user.profileWeb);
  seedFreshSettings(user);
  recordKeychainMigrationIfNeeded(user);
}

function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    const st = lstatSync(from);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) copyDir(from, to);
    else {
      const mode = st.mode & 0o111 ? 0o700 : 0o600;
      const bytes = readRegularFileNoFollow(from);
      if (!bytes) throw new PenglaiError("STORE_CORRUPT", `runtime seed changed while copying: ${from}`);
      writeFileSync(to, bytes, { mode, flag: "wx" });
      chmodSync(to, mode);
    }
  }
}

export interface Journal {
  id: string;
  phase: "idle" | "staging" | "activating" | "committed" | "rolled_back";
  lastGood?: string;
  staging?: string;
  backup?: string;
}

export function writeJournal(user: UserLayout, journal: Journal): void {
  writeFileSync(join(user.transactions, "journal.json"), JSON.stringify(journal, null, 2), { mode: 0o600 });
}

export function readJournal(user: UserLayout): Journal {
  const p = join(user.transactions, "journal.json");
  if (!existsSync(p)) return { id: "none", phase: "idle" };
  return JSON.parse(readFileSync(p, "utf8")) as Journal;
}

export interface CenterPrebootRecovery {
  phase: "idle" | "committed" | "rolled_back";
  id?: string;
  previousEnabled?: boolean;
}

function pathWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertOwnedCenterPath(user: UserLayout, path: string, label: string): void {
  if (!pathWithin(user.root, path) || resolve(path) === resolve(user.root)) {
    throw new PenglaiError("SECURITY_POLICY", `${label} escaped userData`);
  }
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", `${label} must not be a symlink`);
  }
}

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
  renameSync(temp, path);
}

export function recoverCenterProfileTransaction(user: UserLayout): CenterPrebootRecovery {
  const txDir = join(user.root, "profiles", "center-tx");
  const journalPath = join(txDir, "journal.json");
  const lockPath = join(txDir, "active.lock");
  const lastGood = join(txDir, "last-good");
  const activationBackup = `${user.profileWeb}.center-backup`;
  assertOwnedCenterPath(user, txDir, "Center transaction directory");
  assertOwnedCenterPath(user, user.profileWeb, "Center profile");
  healCenterLastGoodArtifacts(txDir);
  if (!existsSync(journalPath)) {
    rmSync(lockPath, { force: true });
    return { phase: "idle" };
  }
  const raw = JSON.parse(readFileSync(journalPath, "utf8")) as {
    schema?: unknown;
    operationId?: unknown;
    phase?: unknown;
    id?: unknown;
    previousEnabled?: unknown;
  };
  if (raw.phase === "committed" || raw.phase === "rolled_back") {
    rmSync(lockPath, { force: true });
    if (raw.phase === "committed") {
      assertOwnedCenterPath(user, activationBackup, "Center activation backup");
      rmSync(activationBackup, { recursive: true, force: true });
    }
    return { phase: raw.phase };
  }
  const active = ["staging", "activating", "verifying"].includes(String(raw.phase));
  const knownId = FIRST_PARTY_PLUGIN_METADATA.some((entry) => entry.id === raw.id);
  if (
    !active ||
    raw.schema !== 2 ||
    typeof raw.operationId !== "string" ||
    typeof raw.id !== "string" ||
    !knownId ||
    typeof raw.previousEnabled !== "boolean"
  ) {
    throw new PenglaiError("STORE_CORRUPT", "Center preboot recovery journal invalid");
  }
  assertOwnedCenterPath(user, lastGood, "Center last-good profile");
  if (!existsSync(lastGood) || !lstatSync(lastGood).isDirectory()) {
    throw new PenglaiError("STORE_CORRUPT", "Center last-good profile missing");
  }
  const staging = join(txDir, `preboot-recovery-${randomUUID()}`);
  const backup = `${user.profileWeb}.preboot-recovery-backup`;
  assertOwnedCenterPath(user, staging, "Center recovery staging");
  assertOwnedCenterPath(user, backup, "Center recovery backup");
  rmSync(staging, { recursive: true, force: true });
  rmSync(backup, { recursive: true, force: true });
  copyDir(lastGood, staging);
  let movedCurrent = false;
  try {
    if (existsSync(user.profileWeb)) {
      renameSync(user.profileWeb, backup);
      movedCurrent = true;
    }
    renameSync(staging, user.profileWeb);
  } catch (error) {
    if (!existsSync(user.profileWeb) && movedCurrent && existsSync(backup)) {
      renameSync(backup, user.profileWeb);
    }
    throw error;
  }
  const desiredPath = join(user.root, "plugins", "desired.json");
  assertOwnedCenterPath(user, desiredPath, "Center desired state");
  let desired: Record<string, boolean> = {};
  if (existsSync(desiredPath)) {
    const parsed = JSON.parse(readFileSync(desiredPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new PenglaiError("STORE_CORRUPT", "Center desired state invalid");
    }
    desired = Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
    );
  }
  desired[raw.id] = raw.previousEnabled;
  atomicJson(desiredPath, desired);
  atomicJson(journalPath, {
    ...raw,
    phase: "rolled_back",
    recoveredAt: new Date().toISOString(),
  });
  rmSync(backup, { recursive: true, force: true });
  assertOwnedCenterPath(user, activationBackup, "Center activation backup");
  rmSync(activationBackup, { recursive: true, force: true });
  rmSync(lockPath, { force: true });
  return {
    phase: "rolled_back",
    id: raw.id,
    previousEnabled: raw.previousEnabled,
  };
}

function healCenterLastGoodArtifacts(txDir: string): string | undefined {
  const lastGood = join(txDir, "last-good");
  if (existsSync(lastGood)) {
    if (lstatSync(lastGood).isSymbolicLink() || !lstatSync(lastGood).isDirectory()) {
      throw new PenglaiError("STORE_CORRUPT", "Center last-good profile invalid");
    }
    return lastGood;
  }
  if (!existsSync(txDir)) return undefined;
  const candidates = readdirSync(txDir, { withFileTypes: true }).filter(
    (entry) =>
      entry.isDirectory() &&
      (entry.name.startsWith("last-good-next-") || entry.name.startsWith("last-good-prev-")),
  );
  const next = candidates.filter((entry) => entry.name.startsWith("last-good-next-"));
  const previous = candidates.filter((entry) => entry.name.startsWith("last-good-prev-"));
  if (next.length > 1 || previous.length > 1) {
    throw new PenglaiError("STORE_CORRUPT", "Center last-good recovery is ambiguous");
  }
  const selected = next[0] ?? previous[0];
  if (!selected) return undefined;
  const source = join(txDir, selected.name);
  if (lstatSync(source).isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "Center last-good recovery must not follow a symlink");
  }
  renameSync(source, lastGood);
  return lastGood;
}

export function recoverProfile(user: UserLayout): Journal {
  recoverCenterProfileTransaction(user);
  const j = readJournal(user);
  if (j.phase === "staging") {
    const staging = j.staging ?? join(user.transactions, "staging");
    rmSync(staging, { recursive: true, force: true });
    j.phase = "rolled_back";
    writeJournal(user, j);
  } else if (j.phase === "activating") {
    const staging = j.staging ?? join(user.transactions, "staging");
    const marker = join(user.profileWeb, "package.json");
    if (j.backup && existsSync(j.backup)) {
      rmSync(user.profileWeb, { recursive: true, force: true });
      renameSync(j.backup, user.profileWeb);
      rmSync(staging, { recursive: true, force: true });
      j.phase = "rolled_back";
    } else if (existsSync(marker)) {
      rmSync(staging, { recursive: true, force: true });
      j.phase = "committed";
      delete j.staging;
      delete j.backup;
    } else {
      rmSync(staging, { recursive: true, force: true });
      j.phase = "rolled_back";
    }
    writeJournal(user, j);
  }
  return j;
}

export interface DoctorReport {
  schema: 1;
  release: string;
  node: { path: string; present: boolean };
  dsh: { path: string; present: boolean; expected: string };
  profile: { dshHome: string; exists: boolean };
  runtimeManifest: "pass" | "fail" | "missing";
  pathFallback: false;
}

export function doctor(layout: RuntimeLayout, user: UserLayout): DoctorReport {
  let runtimeManifest: DoctorReport["runtimeManifest"] = "missing";
  try {
    verifyRuntimeManifest(layout);
    runtimeManifest = "pass";
  } catch {
    runtimeManifest = existsSync(layout.manifestPath) ? "fail" : "missing";
  }
  return {
    schema: 1,
    release: PENGLAI_VERSION,
    node: { path: layout.nodeBin, present: existsSync(layout.nodeBin) },
    dsh: { path: layout.dshEntry, present: existsSync(layout.dshEntry), expected: PINNED_DSH },
    profile: { dshHome: user.dshHome, exists: existsSync(user.dshHome) },
    runtimeManifest,
    pathFallback: false,
  };
}

export function doctorExitCode(report: DoctorReport): number {
  if (!report.node.present || !report.dsh.present) return 2;
  if (report.runtimeManifest === "fail" || report.runtimeManifest === "missing") return 2;
  return 0;
}

export async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      s.close(() => {
        if (!addr || typeof addr === "string") reject(new Error("port"));
        else resolvePort(addr.port);
      });
    });
  });
}

export function waitPort(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolveWait, reject) => {
    const tryOnce = () => {
      const sock = createConnection({ host: "127.0.0.1", port });
      sock.once("connect", () => {
        sock.end();
        resolveWait();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error("timeout"));
        else setTimeout(tryOnce, 50);
      });
    };
    tryOnce();
  });
}

export function isOfficialDshHtml(body: string): boolean {
  if (!body.includes('id="root"')) return false;
  if (body.includes("data-penglai-recovery")) return false;
  if (body.includes("This bootstrap page is not the product surface")) return false;
  const hasBoot = body.includes("__DSH_BOOT__") || body.includes("/assets/") || body.includes("dsh-web");
  if (!hasBoot) return false;
  return true;
}

export function isPenglaiProductTitle(title: string): boolean {
  return /蓬莱|Penglai/.test(title) && !/failed to start/i.test(title);
}

export interface OfficialDshProbe {
  status: number;
  body: string;
  official: boolean;
}

export async function probeOfficialDsh(
  url: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<OfficialDshProbe> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, Math.max(1, Math.floor(timeoutMs)));
  timer.unref?.();
  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.text();
    return { status: res.status, body, official: res.status === 200 && isOfficialDshHtml(body) };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}

export async function waitHttp200(url: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  const start = Date.now();
  let last = 0;
  let body = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const remaining = Math.max(1, timeoutMs - (Date.now() - start));
      const probe = await probeOfficialDsh(url, Math.min(SUPERVISOR_HEALTH_TIMEOUT_MS, remaining));
      last = probe.status;
      body = probe.body;
      if (probe.official) return { status: 200, body };
    } catch {
      /* retry */
    }
    await delay(100);
  }
  throw new PenglaiError("DSH_UNAVAILABLE", `official web HTTP ${last} is not a 200 official DSH document`);
}

export function inventorySnapshotPath(user: UserLayout): string {
  return join(user.root, "plugins", "inventory-snapshot.json");
}

export function readInventorySnapshot(user: UserLayout): InventoryProof | undefined {
  const p = inventorySnapshotPath(user);
  if (!existsSync(p)) return undefined;
  try {
    return evaluateInventory(JSON.parse(readFileSync(p, "utf8")));
  } catch {
    return undefined;
  }
}

export async function waitInventory(user: UserLayout, timeoutMs: number): Promise<InventoryProof> {
  const start = Date.now();
  let last: InventoryProof | undefined;
  while (Date.now() - start < timeoutMs) {
    last = readInventorySnapshot(user);
    if (last?.ok) return last;
    await delay(200);
  }
  throw new PenglaiError(
    "DSH_UNAVAILABLE",
    `distribution inventory not ready credentials=${String(last?.credentials)} center=${String(last?.pluginCenter)} office=${String(last?.office)} memory=${String(last?.memory)} optionalIm=${String(last?.im)} smokeDisabled=${String(last?.smokeDisabled)}`,
  );
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export function killProcessTree(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

export {
  USER_SCHEMA,
  clearIdentity,
  identityPath,
  killIdentity,
  leftoverDsh,
  listDshCandidates,
  migrateUserSchema,
  processStillMatches,
  readIdentity,
  readProcessPgid,
  readProcessStartMs,
  reapDshOrphans,
  writeIdentity,
  type ProcessIdentity,
} from "./process.js";

export * from "./plugin-catalog.js";
export { selectCatalogArtifact } from "@penglai/plugin-registry";
export * from "./safe-tar.js";
export * from "./plugin-owner.js";
export * from "./generation-migrate.js";
export * from "./boot-revoke.js";
export * from "./inventory-proof.js";
export * from "./private-mode.js";
export * from "./owner-broker.js";
export * from "./owner-dialog.js";

export function processesMatching(marker: string): Array<{ pid: number; command: string }> {
  if (!marker || marker.length < 8) return [];
  try {
    const out = execFileSync("/usr/bin/pgrep", ["-fl", marker], { encoding: "utf8" });
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const sp = line.indexOf(" ");
        const pid = Number(sp === -1 ? line : line.slice(0, sp));
        const command = sp === -1 ? "" : line.slice(sp + 1);
        return { pid, command };
      })
      .filter((row) => Number.isInteger(row.pid) && row.pid > 0 && row.pid !== process.pid);
  } catch {
    return [];
  }
}

function waitChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolveWait) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveWait();
      return;
    }
    const t = setTimeout(() => resolveWait(), timeoutMs);
    child.once("exit", () => {
      clearTimeout(t);
      resolveWait();
    });
  });
}

export function killStaleSupervisor(layout: RuntimeLayout, user: UserLayout): void {
  const previous = readIdentity(user);
  if (previous) {
    killIdentity({ ...previous, appRoot: layout.appRoot }, "SIGKILL");
    clearIdentity(user);
  }
  reapDshOrphans(layout);
}

/**
 * Build the official rc.2 Web invocation used by every embedded supervisor.
 * DSH Web intentionally opens the operating-system browser unless --no-open
 * is present; Penglai owns its BrowserWindow, so an external handoff would
 * leak the authenticated loopback surface and create one Safari tab per boot.
 */
export function dshWebArgs(port: number): string[] {
  return ["--profile", "web", "--no-open", "--host", "127.0.0.1", "--port", String(port)];
}

export function windowsOwnedProcessEnvironment(
  userRoot: string,
  sourceEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const systemRoot = sourceEnv.SystemRoot || sourceEnv.WINDIR || "C:\\Windows";
  const temp = join(userRoot, "temp");
  const appData = join(userRoot, "AppData", "Roaming");
  const localAppData = join(userRoot, "AppData", "Local");
  for (const path of [temp, appData, localAppData]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  return {
    PATH: `${join(systemRoot, "System32")};${systemRoot}`,
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    ComSpec: sourceEnv.ComSpec || join(systemRoot, "System32", "cmd.exe"),
    PATHEXT: sourceEnv.PATHEXT || ".COM;.EXE;.BAT;.CMD",
    ProgramData: sourceEnv.ProgramData || "C:\\ProgramData",
    USERPROFILE: userRoot,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    TEMP: temp,
    TMP: temp,
  };
}

export interface EmbeddedDshSupervisorOptions {
  healthIntervalMs?: number;
  healthTimeoutMs?: number;
  unhealthyKillGraceMs?: number;
  startupHttpTimeoutMs?: number;
  inventoryTimeoutMs?: number;
  restartBackoffMs?: number;
  onRecoveryStateChange?: (snapshot: Readonly<SupervisorRecoverySnapshot>) => void;
}

export type EmbeddedDshSupervisorState = "stopped" | "starting" | "healthy" | "degraded" | "crashed" | "stopping";

export class EmbeddedDshSupervisor {
  state: EmbeddedDshSupervisorState = "stopped";
  port = 0;
  child: ChildProcess | undefined;
  restarts = 0;
  restartStamps: number[] = [];
  logs = "";
  identity: ProcessIdentity | undefined;
  recovery: SupervisorRecoverySnapshot = { ...IDLE_SUPERVISOR_RECOVERY };
  private stateChangedAt = Date.now();
  private pendingFailure: SupervisorFailureTrigger | undefined;
  private lastUser: UserLayout | undefined;
  private lastStartEnv: NodeJS.ProcessEnv = {};
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private healthTimer: ReturnType<typeof setTimeout> | undefined;
  private unhealthyKillTimer: ReturnType<typeof setTimeout> | undefined;
  private healthProbeAbort: AbortController | undefined;
  private healthFailures = 0;
  private lifecycleGeneration = 0;
  private lastHealthyInventory: InventoryProof | undefined;
  health:
    | {
        http: number;
        inventory: InventoryProof;
      }
    | undefined;

  constructor(
    private readonly layout: RuntimeLayout,
    private readonly options: EmbeddedDshSupervisorOptions = {},
  ) {}

  get phaseMs(): number {
    return Math.max(0, Date.now() - this.stateChangedAt);
  }

  private setState(state: EmbeddedDshSupervisorState): void {
    if (this.state === state) return;
    this.state = state;
    this.stateChangedAt = Date.now();
  }

  private setRecovery(recovery: SupervisorRecoverySnapshot): void {
    if (
      this.recovery.status === recovery.status &&
      this.recovery.reason === recovery.reason &&
      this.recovery.attempt === recovery.attempt &&
      this.recovery.maxAttempts === recovery.maxAttempts &&
      this.recovery.exitCode === recovery.exitCode &&
      this.recovery.trigger === recovery.trigger &&
      this.recovery.lastFailure === recovery.lastFailure
    ) return;
    this.recovery = { ...recovery };
    try {
      this.options.onRecoveryStateChange?.({ ...this.recovery });
    } catch {
      // Recovery observers are UI hints. They must never destabilize the owner.
    }
  }

  private recentRestartCount(now = Date.now()): number {
    this.restartStamps = this.restartStamps.filter((stamp) => now - stamp < SUPERVISOR_RESTART_WINDOW_MS);
    return this.restartStamps.length;
  }

  private boundedOption(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) ? Math.max(1, Math.floor(value!)) : fallback;
  }

  private clearHealthMonitoring(): void {
    if (this.healthTimer) clearTimeout(this.healthTimer);
    if (this.unhealthyKillTimer) clearTimeout(this.unhealthyKillTimer);
    this.healthTimer = undefined;
    this.unhealthyKillTimer = undefined;
    this.healthProbeAbort?.abort();
    this.healthProbeAbort = undefined;
    this.healthFailures = 0;
  }

  private scheduleHealthProbe(user: UserLayout, generation: number): void {
    if (generation !== this.lifecycleGeneration) return;
    if (this.state !== "healthy" && this.state !== "degraded") return;
    this.healthTimer = setTimeout(() => {
      this.healthTimer = undefined;
      void this.runHealthProbe(user, generation);
    }, this.boundedOption(this.options.healthIntervalMs, SUPERVISOR_HEALTH_INTERVAL_MS));
    this.healthTimer.unref?.();
  }

  private async runHealthProbe(user: UserLayout, generation: number): Promise<void> {
    if (generation !== this.lifecycleGeneration) return;
    if (this.state !== "healthy" && this.state !== "degraded") return;
    const controller = new AbortController();
    this.healthProbeAbort = controller;
    let healthy = false;
    try {
      const probe = await probeOfficialDsh(
        `http://127.0.0.1:${this.port}/`,
        this.boundedOption(this.options.healthTimeoutMs, SUPERVISOR_HEALTH_TIMEOUT_MS),
        controller.signal,
      );
      healthy = probe.official;
    } catch {
      healthy = false;
    } finally {
      if (this.healthProbeAbort === controller) this.healthProbeAbort = undefined;
    }
    if (generation !== this.lifecycleGeneration || controller.signal.aborted) return;
    const decision = nextSupervisorHealthDecision(this.healthFailures, healthy);
    this.healthFailures = decision.consecutiveFailures;
    this.setState(decision.state);
    if (healthy && this.lastHealthyInventory) {
      this.health = { http: 200, inventory: this.lastHealthyInventory };
    } else if (!healthy) {
      this.health = undefined;
    }
    if (!decision.restart) {
      this.scheduleHealthProbe(user, generation);
      return;
    }
    this.pendingFailure = "health-check-failed";
    this.setRecovery({
      status: "recovering",
      reason: "health-check-failed",
      attempt: this.recentRestartCount() + 1,
      maxAttempts: SUPERVISOR_RESTART_MAX,
      exitCode: null,
      trigger: "health-check-failed",
      lastFailure: "health-check-failed",
    });
    this.terminateUnhealthyChild(generation);
  }

  private terminateUnhealthyChild(generation: number): void {
    if (generation !== this.lifecycleGeneration || this.state !== "degraded") return;
    const child = this.child;
    const identity = this.identity;
    if (identity) killIdentity(identity, "SIGTERM");
    else if (child?.pid) killProcessTree(child.pid, "SIGTERM");
    else {
      this.scheduleRestartAfterExit(false, "health-check-failed", null);
      return;
    }
    this.unhealthyKillTimer = setTimeout(() => {
      this.unhealthyKillTimer = undefined;
      if (generation !== this.lifecycleGeneration || this.state !== "degraded" || this.child !== child) return;
      if (identity) killIdentity(identity, "SIGKILL");
      else if (child?.pid) killProcessTree(child.pid, "SIGKILL");
    }, this.boundedOption(this.options.unhealthyKillGraceMs, SUPERVISOR_UNHEALTHY_KILL_GRACE_MS));
    this.unhealthyKillTimer.unref?.();
  }

  private scheduleRestartAfterExit(intentional: boolean, failure: SupervisorFailureTrigger, exitCode: number | null): void {
    this.pendingFailure = undefined;
    const recoveryExitCode = exitCode ?? this.recovery.exitCode;
    const now = Date.now();
    const attempts = this.recentRestartCount(now);
    const trigger = this.recovery.status === "recovering" && this.recovery.trigger !== "none"
      ? this.recovery.trigger
      : failure;
    if (intentional || this.state === "stopping" || this.state === "stopped") return;
    if (this.state === "starting") {
      // start() owns readiness failures. Its automatic-restart caller consumes
      // the next budget slot after cleanup; initial boot reports only once.
      this.setState("crashed");
      return;
    }
    if (
      !shouldRestartAfterExit({
        intentional: false,
        state: this.state,
        stamps: this.restartStamps,
        now,
      })
    ) {
      this.setState("crashed");
      this.setRecovery({
        status: "manual-action-required",
        reason: "restart-budget-exhausted",
        attempt: attempts,
        maxAttempts: SUPERVISOR_RESTART_MAX,
        exitCode: recoveryExitCode,
        trigger,
        lastFailure: failure,
      });
      return;
    }
    this.restartStamps.push(now);
    this.restarts += 1;
    this.setState("crashed");
    this.setRecovery({
      status: "recovering",
      reason: failure,
      attempt: attempts + 1,
      maxAttempts: SUPERVISOR_RESTART_MAX,
      exitCode: recoveryExitCode,
      trigger,
      lastFailure: failure,
    });
    const user = this.lastUser;
    if (!user) {
      this.setRecovery({
        status: "manual-action-required",
        reason: "restart-start-failed",
        attempt: attempts + 1,
        maxAttempts: SUPERVISOR_RESTART_MAX,
        exitCode: recoveryExitCode,
        trigger,
        lastFailure: failure,
      });
      return;
    }
    const restartEnv = { ...this.lastStartEnv };
    const restartPort = this.port;
    const delay = this.options.restartBackoffMs === undefined
      ? supervisorBackoffMs(attempts, Math.random())
      : this.boundedOption(this.options.restartBackoffMs, supervisorBackoffMs(attempts, 0));
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.state === "stopping" || this.state === "stopped") return;
      void this.start(user, restartEnv, restartPort).catch(() => {
        if (this.state === "stopping" || this.state === "stopped") return;
        this.setState("crashed");
        this.scheduleRestartAfterExit(false, "restart-start-failed", null);
      });
    }, delay);
    this.restartTimer.unref?.();
  }

  private async terminateOwnedChild(user: UserLayout | undefined): Promise<void> {
    const child = this.child;
    const identity = this.identity;
    if (identity) killIdentity(identity, "SIGTERM");
    else if (child?.pid) killProcessTree(child.pid, "SIGTERM");
    if (child) await waitChildExit(child, 3000);
    if (identity) killIdentity(identity, "SIGKILL");
    else if (child?.pid) killProcessTree(child.pid, "SIGKILL");
    if (child) await waitChildExit(child, 1000);
    reapDshOrphans(this.layout);
    if (user) clearIdentity(user);
    this.child = undefined;
    this.identity = undefined;
  }

  async start(user: UserLayout, env: NodeJS.ProcessEnv = {}, preferredPort?: number): Promise<{ port: number }> {
    if (this.state === "healthy" || this.state === "starting" || this.state === "degraded") {
      return { port: this.port };
    }
    const automaticRecovery = this.recovery.status === "recovering";
    if (!automaticRecovery) {
      this.restartStamps = [];
      this.restarts = 0;
      this.setRecovery({ ...IDLE_SUPERVISOR_RECOVERY });
    }
    this.clearHealthMonitoring();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    const generation = ++this.lifecycleGeneration;
    assertAbsoluteExecutable(this.layout.nodeBin, "embedded node");
    assertAbsoluteExecutable(this.layout.dshEntry, "embedded dsh");
    // A supervisor must not launch a runtime whose integrity manifest is
    // absent or does not cover the embedded tree.
    verifyRuntimeManifest(this.layout);
    this.lastUser = user;
    this.lastStartEnv = {
      ...(env.LANG ? { LANG: env.LANG } : {}),
      ...(env.PENGLAI_PLUGINS_DIR ? { PENGLAI_PLUGINS_DIR: env.PENGLAI_PLUGINS_DIR } : {}),
      ...(env.PENGLAI_APP_ROOT ? { PENGLAI_APP_ROOT: env.PENGLAI_APP_ROOT } : {}),
      ...(env.PENGLAI_MNEMON_BINARY ? { PENGLAI_MNEMON_BINARY: env.PENGLAI_MNEMON_BINARY } : {}),
    };
    migrateUserSchema(user);
    killStaleSupervisor(this.layout, user);
    this.setState("starting");
    this.logs = "";
    this.health = undefined;
    this.identity = undefined;
    this.lastHealthyInventory = undefined;
    this.port = reusableSupervisorPort(preferredPort) ?? await freePort();
    const childEnv: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      HOME: user.root,
      PENGLAI_REAL_HOME: userInfo().homedir,
      DSH_HOME: user.dshHome,
      PENGLAI_USER_DATA: user.root,
      PENGLAI_DSH_PIN: PINNED_DSH,
      // Penglai does not operate a telemetry backend. Apply DSH's hard-disable
      // switch after every profile patch so a local profile cannot activate the
      // bundled OTel exporter or its dormant vendor endpoint.
      DSH_TELEMETRY_DISABLED: "1",
      LANG: env.LANG ?? "en_US.UTF-8",
      ...(env.PENGLAI_PLUGINS_DIR ? { PENGLAI_PLUGINS_DIR: env.PENGLAI_PLUGINS_DIR } : {}),
      ...(env.PENGLAI_APP_ROOT ? { PENGLAI_APP_ROOT: env.PENGLAI_APP_ROOT } : {}),
      ...(env.PENGLAI_MNEMON_BINARY
        ? { PENGLAI_MNEMON_BINARY: env.PENGLAI_MNEMON_BINARY }
        : {}),
    };
    const dshArgs = dshWebArgs(this.port);
    if (process.platform === "win32") {
      Object.assign(childEnv, windowsOwnedProcessEnvironment(user.root));
      const spawned = spawnOwnedDshProcess({
        platform: "win32",
        executable: this.layout.nodeBin,
        entry: this.layout.dshEntry,
        args: dshArgs,
        env: childEnv,
        port: this.port,
        cwd: user.dshHome,
        appRoot: this.layout.appRoot,
      });
      this.child = spawned.child;
      const report = await readOwnedWindowsJobReport(spawned.child);
      if (!report.pid || !report.owner) {
        throw new PenglaiError("SECURITY_POLICY", "native Windows job supervisor report incomplete");
      }
      const startMs = report.startMs || spawned.identity.startMs;
      const supervisorPid = spawned.child.pid;
      if (!supervisorPid) {
        throw new PenglaiError("SECURITY_POLICY", "native Windows job supervisor pid missing");
      }
      this.identity = {
        pid: report.pid,
        pgid: report.pid,
        startMs,
        executable: this.layout.nodeBin,
        dshEntry: this.layout.dshEntry,
        port: this.port,
        startedAt: new Date(startMs).toISOString(),
        platform: "win32",
        appRoot: this.layout.appRoot,
        owner: report.owner,
        jobAssigned: true,
        supervisorPid,
      };
      writeIdentity(user, this.identity);
    } else {
      this.child = spawn(this.layout.nodeBin, [this.layout.dshEntry, ...dshArgs], {
        env: childEnv,
        cwd: user.dshHome,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      const pid = this.child.pid;
      if (pid) {
        const startMs = readProcessStartMs(pid) || Date.now();
        this.identity = {
          pid,
          pgid: readProcessPgid(pid),
          startMs,
          executable: this.layout.nodeBin,
          dshEntry: this.layout.dshEntry,
          port: this.port,
          startedAt: new Date(startMs).toISOString(),
          platform: "darwin",
        };
        writeIdentity(user, this.identity);
      }
    }
    this.child.stdout?.on("data", (d: Buffer) => {
      this.logs = `${this.logs}${String(d)}`.slice(-40_000);
    });
    this.child.stderr?.on("data", (d: Buffer) => {
      this.logs = `${this.logs}${String(d)}`.slice(-40_000);
    });
    this.child.on("exit", (code) => {
      if (generation !== this.lifecycleGeneration) return;
      const intentional = this.state === "stopping";
      const failure = this.pendingFailure ?? "process-exit";
      this.pendingFailure = undefined;
      this.clearHealthMonitoring();
      this.health = undefined;
      this.scheduleRestartAfterExit(intentional, failure, code);
    });
    try {
      await waitPort(this.port, 25_000);
      const [http, inventory] = await Promise.all([
        waitHttp200(`http://127.0.0.1:${this.port}/`, this.boundedOption(this.options.startupHttpTimeoutMs, 25_000)),
        waitInventory(user, this.boundedOption(this.options.inventoryTimeoutMs, 30_000)),
      ]);
      this.health = { http: http.status, inventory };
      this.lastHealthyInventory = inventory;
      this.setState("healthy");
      if (automaticRecovery) this.setRecovery({ ...this.recovery, status: "recovered" });
      this.scheduleHealthProbe(user, generation);
    } catch (err) {
      if (generation === this.lifecycleGeneration) {
        this.lifecycleGeneration += 1;
        this.clearHealthMonitoring();
        this.setState("crashed");
        try {
          mkdirSync(user.logs, { recursive: true, mode: 0o700 });
          writeFileSync(
            join(user.logs, "dsh.stderr.log"),
            redactSupervisorLog(this.logs, [user.root, user.dshHome, userInfo().homedir, this.layout.appRoot]),
            { mode: 0o600 },
          );
        } catch {
          // Structured recovery remains available if the local excerpt cannot be persisted.
        }
        await this.terminateOwnedChild(user);
        this.setState("crashed");
      }
      throw err;
    }
    return { port: this.port };
  }

  async stop(): Promise<void> {
    this.lifecycleGeneration += 1;
    this.pendingFailure = undefined;
    this.clearHealthMonitoring();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    this.setState("stopping");
    await this.terminateOwnedChild(this.lastUser);
    this.setState("stopped");
    if (this.recovery.status !== "manual-action-required") {
      this.setRecovery({ ...IDLE_SUPERVISOR_RECOVERY });
    }
  }
}
