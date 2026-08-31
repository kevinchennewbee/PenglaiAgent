import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PenglaiError, redactedDiagnosticReference } from "@penglai/contracts";
import {
  assertPluginPackageManifest,
  extractTarGz,
  inspectTarGz,
  sha256File,
  type PluginCatalogEntry,
} from "@penglai/runtime/plugin-host";
import {
  assertManifestMatchesCatalog,
  inspectPluginEntries,
  type ArchiveFile,
} from "@penglai/plugin-registry";

export interface ProfileTxResult {
  phase: "committed" | "rolled_back";
  id: string;
  action: "enable" | "disable" | "update" | "rollback" | "install";
  operationId?: string;
  version?: string;
  restartRequired?: boolean;
  previousEnabled?: boolean;
}

export interface ResourceCounts {
  workers: number;
  sockets: number;
  timers: number;
  remotes: number;
  db: number;
  modelSessions: number;
  audioHandles: number;
  activeJobs?: number;
  queuedJobs?: number;
  remoteRequests?: number;
  workerThreads?: number;
  childProcesses?: number;
  openFiles?: number;
}

export type PluginActivationPhase =
  | "missing"
  | "pending"
  | "loading"
  | "active"
  | "unloading"
  | "disabled"
  | "failed"
  | "unknown";

export interface PluginActivationObservation {
  source: "official-inventory";
  at: string;
  present: boolean;
  enabled: boolean;
  phase: PluginActivationPhase;
}

interface PluginActivationTrace {
  expectedPresent: boolean;
  expectedEnabled: boolean;
  outcome: "pending" | "verified" | "timed_out" | "failed";
  observations: PluginActivationObservation[];
  finalReadback?: PluginActivationObservation;
}

export interface PluginTransactionDiagnostic {
  schema: 2;
  referenceId: string;
  id: string;
  action: ProfileTxResult["action"];
  phase: "staging" | "activating" | "verifying" | "committed" | "rolled_back";
  failureCode?: TransactionJournal["failureCode"];
  activation: PluginActivationTrace;
  rollback?: PluginActivationTrace;
}

interface TransactionJournal {
  schema: 3;
  operationId: string;
  phase: "staging" | "activating" | "verifying" | "committed" | "rolled_back";
  lastGoodPhase?: "snapshot" | "snapshot-ready" | "promote-prev" | "promote-next" | "promote-done";
  id: string;
  action: ProfileTxResult["action"];
  previousEnabled: boolean;
  previousPresent: boolean;
  version?: string;
  packageSha256?: string;
  errorClass?: string;
  failureCode?:
    | "PLUGIN_ACTIVATION_TIMEOUT"
    | "PLUGIN_RUNTIME_UNAVAILABLE"
    | "PLUGIN_PACKAGE_REJECTED"
    | "PLUGIN_PROFILE_INVALID"
    | "PLUGIN_ACTION_REJECTED"
    | "PLUGIN_ROLLBACK_FAILED";
  activation: PluginActivationTrace;
  rollback?: PluginActivationTrace;
}

export function pluginActionFailureCode(
  error: unknown,
): NonNullable<TransactionJournal["failureCode"]> {
  if (error instanceof AggregateError) return "PLUGIN_ROLLBACK_FAILED";
  if (!(error instanceof PenglaiError)) return "PLUGIN_RUNTIME_UNAVAILABLE";
  if (error.message === "PLUGIN_ACTIVATION_TIMEOUT") {
    return "PLUGIN_ACTIVATION_TIMEOUT";
  }
  if (error.errorClass === "SECURITY_POLICY") return "PLUGIN_PACKAGE_REJECTED";
  if (error.errorClass === "STORE_CORRUPT") return "PLUGIN_PROFILE_INVALID";
  if (error.errorClass === "INVALID_INPUT") return "PLUGIN_ACTION_REJECTED";
  return "PLUGIN_RUNTIME_UNAVAILABLE";
}

const ACTIVATION_PHASES = new Set<PluginActivationPhase>([
  "missing",
  "pending",
  "loading",
  "active",
  "unloading",
  "disabled",
  "failed",
  "unknown",
]);
const TRACE_OUTCOMES = new Set<PluginActivationTrace["outcome"]>([
  "pending",
  "verified",
  "timed_out",
  "failed",
]);
const TRANSACTION_PHASES = new Set<PluginTransactionDiagnostic["phase"]>([
  "staging",
  "activating",
  "verifying",
  "committed",
  "rolled_back",
]);
const TRANSACTION_ACTIONS = new Set<ProfileTxResult["action"]>([
  "enable",
  "disable",
  "update",
  "rollback",
  "install",
]);
const FAILURE_CODES = new Set<NonNullable<TransactionJournal["failureCode"]>>([
  "PLUGIN_ACTIVATION_TIMEOUT",
  "PLUGIN_RUNTIME_UNAVAILABLE",
  "PLUGIN_PACKAGE_REJECTED",
  "PLUGIN_PROFILE_INVALID",
  "PLUGIN_ACTION_REJECTED",
  "PLUGIN_ROLLBACK_FAILED",
]);

function safeObservation(value: unknown): PluginActivationObservation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (
    row.source !== "official-inventory" ||
    typeof row.at !== "string" ||
    row.at.length > 64 ||
    typeof row.present !== "boolean" ||
    typeof row.enabled !== "boolean" ||
    !ACTIVATION_PHASES.has(row.phase as PluginActivationPhase)
  ) {
    return undefined;
  }
  return {
    source: "official-inventory",
    at: row.at,
    present: row.present,
    enabled: row.enabled,
    phase: row.phase as PluginActivationPhase,
  };
}

function safeTrace(value: unknown): PluginActivationTrace | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (
    typeof row.expectedPresent !== "boolean" ||
    typeof row.expectedEnabled !== "boolean" ||
    !TRACE_OUTCOMES.has(row.outcome as PluginActivationTrace["outcome"])
  ) {
    return undefined;
  }
  const observations = Array.isArray(row.observations)
    ? row.observations.map(safeObservation).filter(Boolean).slice(-32)
    : [];
  const finalReadback = safeObservation(row.finalReadback);
  return {
    expectedPresent: row.expectedPresent,
    expectedEnabled: row.expectedEnabled,
    outcome: row.outcome as PluginActivationTrace["outcome"],
    observations: observations as PluginActivationObservation[],
    ...(finalReadback ? { finalReadback } : {}),
  };
}

export function readPluginTransactionDiagnostic(
  txDir: string,
): PluginTransactionDiagnostic | null {
  const path = join(txDir, "journal.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const activation = safeTrace(raw.activation);
    const rollback = safeTrace(raw.rollback);
    if (
      typeof raw.operationId !== "string" ||
      !raw.operationId ||
      raw.operationId.length > 256 ||
      typeof raw.id !== "string" ||
      !raw.id ||
      raw.id.length > 160 ||
      !TRANSACTION_ACTIONS.has(raw.action as ProfileTxResult["action"]) ||
      !TRANSACTION_PHASES.has(raw.phase as PluginTransactionDiagnostic["phase"]) ||
      !activation
    ) {
      return null;
    }
    const failureCode = FAILURE_CODES.has(
      raw.failureCode as NonNullable<TransactionJournal["failureCode"]>,
    )
      ? (raw.failureCode as NonNullable<TransactionJournal["failureCode"]>)
      : undefined;
    const referenceId = redactedDiagnosticReference(
      "PC",
      raw.operationId,
      raw.id,
      String(raw.action),
    );
    return {
      schema: 2,
      referenceId,
      id: raw.id,
      action: raw.action as ProfileTxResult["action"],
      phase: raw.phase as PluginTransactionDiagnostic["phase"],
      ...(failureCode ? { failureCode } : {}),
      activation,
      ...(rollback ? { rollback } : {}),
    };
  } catch {
    return null;
  }
}

function isUnder(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertTransactionPaths(opts: {
  userDataRoot: string;
  profileDir: string;
  txDir: string;
}): void {
  if (
    !isAbsolute(opts.userDataRoot) ||
    !isUnder(opts.userDataRoot, opts.profileDir) ||
    !isUnder(opts.userDataRoot, opts.txDir) ||
    resolve(opts.profileDir) === resolve(opts.userDataRoot) ||
    resolve(opts.txDir) === resolve(opts.userDataRoot)
  ) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "Center transaction path escaped userData",
    );
  }
  if (
    existsSync(opts.profileDir) &&
    lstatSync(opts.profileDir).isSymbolicLink()
  ) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "Center profile must not be a symlink",
    );
  }
  if (existsSync(opts.txDir) && lstatSync(opts.txDir).isSymbolicLink()) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "Center transaction dir must not be a symlink",
    );
  }
}

function copyDir(src: string, dest: string): void {
  if (!existsSync(src) || !lstatSync(src).isDirectory()) {
    throw new PenglaiError("STORE_CORRUPT", "profile directory missing");
  }
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
  cpSync(src, dest, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
    preserveTimestamps: false,
  });
}

function atomicJournal(path: string, value: unknown): void {
  atomicPrivateText(path, JSON.stringify(value, null, 2));
}

function atomicPrivateText(path: string, value: string): void {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, value, {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function setPatchDisabled(
  patchText: string,
  pluginId: string,
  disabled: boolean,
): string {
  const short = pluginId.replace("@penglai/", "penglai-");
  const endsWithNl = patchText.endsWith("\n");
  const lines = patchText.split("\n");
  const out: string[] = [];
  let block: string[] = [];
  let matches = 0;
  const flush = (): void => {
    if (!block.length) return;
    const text = block.join("\n");
    const hit =
      text.includes(`name: "${pluginId}"`) ||
      text.includes(`name: '${pluginId}'`) ||
      text.includes(`id: ${short}`);
    if (hit) {
      matches += 1;
      const idLine = block.find((line) => /^\s*-\s+id:\s+/.test(line)) ?? "";
      const idIndent = /^(\s*)/.exec(idLine)?.[1] ?? "    ";
      const fieldIndent = `${idIndent}  `;
      const kept = block.filter((line) => !/^\s*disabled:\s+/.test(line));
      while (kept.length && kept[kept.length - 1] === "") kept.pop();
      kept.push(`${fieldIndent}disabled: ${disabled ? "true" : "false"}`);
      out.push(...kept);
    } else {
      out.push(...block);
    }
    block = [];
  };
  for (const line of lines) {
    if (/^\s*-\s+id:\s+/.test(line)) flush();
    block.push(line);
  }
  flush();
  if (matches !== 1) {
    throw new PenglaiError(
      "STORE_CORRUPT",
      `${pluginId} profile entry count ${matches}`,
    );
  }
  const joined = out.join("\n");
  return endsWithNl && !joined.endsWith("\n") ? `${joined}\n` : joined;
}

export function upsertPatchDisabled(
  patchText: string,
  pluginId: string,
  disabled: boolean,
): string {
  try {
    return setPatchDisabled(patchText, pluginId, disabled);
  } catch {
    const short = pluginId.replace(/^@/, "").replaceAll("/", "-");
    const row = `    - id: ${short}\n      name: "${pluginId}"\n      disabled: ${disabled ? "true" : "false"}\n`;
    return patchText.endsWith("\n")
      ? `${patchText}${row}`
      : `${patchText}\n${row}`;
  }
}

export { sha256File };

function readVerifiedPackage(
  packageFile: string,
  expectedSha: string,
): { bytes: Buffer; sha256: string } {
  if (!/^[0-9a-f]{64}$/.test(expectedSha)) {
    throw new PenglaiError("SECURITY_POLICY", "checksum required");
  }
  let fd: number | undefined;
  let bytes: Buffer;
  try {
    fd = openSync(packageFile, "r");
    const opened = fstatSync(fd);
    const named = lstatSync(packageFile);
    if (
      !opened.isFile() ||
      named.isSymbolicLink() ||
      !named.isFile() ||
      opened.dev !== named.dev ||
      opened.ino !== named.ino
    ) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        "plugin package must be one regular file",
      );
    }
    bytes = readFileSync(fd);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new PenglaiError("INVALID_INPUT", "package missing");
    }
    if (error instanceof PenglaiError) throw error;
    throw new PenglaiError(
      "SECURITY_POLICY",
      "plugin package could not be opened safely",
    );
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const got = createHash("sha256").update(bytes).digest("hex");
  if (expectedSha !== got) {
    throw new PenglaiError("SECURITY_POLICY", "checksum mismatch");
  }
  return { bytes, sha256: got };
}

export function assertPackageIntegrity(
  packageFile: string,
  expectedSha: string,
): string {
  return readVerifiedPackage(packageFile, expectedSha).sha256;
}

function extractedRoot(directory: string): string {
  if (existsSync(join(directory, "package.json"))) return directory;
  const nested = join(directory, "package");
  if (existsSync(join(nested, "package.json"))) return nested;
  throw new PenglaiError("STORE_CORRUPT", "package.json missing");
}

async function verifyExtractedPackage(
  directory: string,
  entry: PluginCatalogEntry,
  importModule = true,
  archiveFiles?: readonly ArchiveFile[],
): Promise<string> {
  const root = extractedRoot(directory);
  if (entry.source === "penglai-plugin-registry") {
    if (!archiveFiles) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        "signed archive inspection evidence missing",
      );
    }
    const inspected = inspectPluginEntries(archiveFiles);
    assertManifestMatchesCatalog({
      catalogId: entry.id,
      catalogVersion: entry.version,
      catalogPermissions: entry.permissions,
      catalogCapabilities: entry.capabilities,
      catalogDsh: entry.dsh.exact,
      manifest: inspected.manifest,
      ...(entry.entry ? { catalogEntry: entry.entry } : {}),
      ...(entry.clientEntry ? { catalogClientEntry: entry.clientEntry } : {}),
      ...(entry.nativeCode === false ? { catalogNativeCode: false } : {}),
      ...(entry.networkOrigins
        ? { catalogNetworkOrigins: entry.networkOrigins }
        : {}),
      ...(entry.dataPaths ? { catalogDataPaths: entry.dataPaths } : {}),
    });
    const host = join(root, inspected.manifest.entry);
    if (!existsSync(host)) {
      throw new PenglaiError(
        "STORE_CORRUPT",
        `${entry.id} host bundle missing`,
      );
    }
    if (
      inspected.manifest.clientEntry &&
      !existsSync(join(root, inspected.manifest.clientEntry))
    ) {
      throw new PenglaiError(
        "STORE_CORRUPT",
        `${entry.id} client bundle missing`,
      );
    }
  } else {
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as unknown;
    assertPluginPackageManifest(manifest, entry);
    const host = join(root, "dist", "index.js");
    if (!existsSync(host)) {
      throw new PenglaiError(
        "STORE_CORRUPT",
        `${entry.id} host bundle missing`,
      );
    }
    if (entry.hasClient && !existsSync(join(root, "dist", "client.js"))) {
      throw new PenglaiError(
        "STORE_CORRUPT",
        `${entry.id} client bundle missing`,
      );
    }
  }
  const host = join(root, entry.entry ?? "dist/index.js");
  const source = readFileSync(host, "utf8");
  if (/from\s+["'][^"']*\/src\/|\.tsx?["']/.test(source)) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      `${entry.id} source dependency in package`,
    );
  }
  if (importModule) {
    const loaded = (await import(
      `${pathToFileURL(host).href}?penglai-dry=${randomUUID()}`
    )) as Record<string, unknown>;
    const plugin = (loaded.default ?? loaded) as Record<string, unknown>;
    if (
      typeof loaded.apply !== "function" &&
      typeof plugin.apply !== "function" &&
      typeof loaded.default !== "function"
    ) {
      throw new PenglaiError(
        "STORE_CORRUPT",
        `${entry.id} plugin apply export missing`,
      );
    }
  }
  return root;
}

export async function dryLoadPackage(
  packageFile: string,
  entry: PluginCatalogEntry,
): Promise<{ name: string; version: string; sha256: string }> {
  const verified = readVerifiedPackage(packageFile, entry.sha256);
  const temp = `${packageFile}.dry-${process.pid}-${randomUUID()}`;
  mkdirSync(temp, { recursive: true, mode: 0o700 });
  try {
    const archiveFiles = extractTarGz(verified.bytes, temp);
    await verifyExtractedPackage(temp, entry, true, archiveFiles);
    return { name: entry.id, version: entry.version, sha256: verified.sha256 };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function assertResourceZero(snapshot: ResourceCounts): void {
  for (const [name, value] of Object.entries(snapshot)) {
    if (!Number.isSafeInteger(value) || value !== 0) {
      throw new PenglaiError(
        "DSH_UNAVAILABLE",
        `plugin resource ${name} not zero: ${String(value)}`,
      );
    }
  }
}

export async function runProfileTransaction(opts: {
  userDataRoot: string;
  profileDir: string;
  txDir: string;
  pluginsDir: string;
  entry: PluginCatalogEntry;
  action: "enable" | "disable" | "update" | "install";
  previousEnabled: boolean;
  previousPresent?: boolean;
  applyLive: (input: {
    id: string;
    enabled: boolean;
    forceReload: boolean;
    present: boolean;
  }) => Promise<void>;
  verifyActual: (input: {
    id: string;
    enabled: boolean;
    present: boolean;
  }, observe: (observation: PluginActivationObservation) => void) => Promise<void>;
  readResources?: () => ResourceCounts;
  commitDesired: (enabled: boolean) => void;
  rollbackDesired: (enabled: boolean) => void;
}): Promise<ProfileTxResult> {
  assertTransactionPaths(opts);
  if (!isAbsolute(opts.pluginsDir)) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      "trusted plugin directory must be absolute",
    );
  }
  mkdirSync(opts.txDir, { recursive: true, mode: 0o700 });
  const operationId = randomUUID();
  const journalPath = join(opts.txDir, "journal.json");
  const lock = join(opts.txDir, "active.lock");
  const lastGood = join(opts.txDir, "last-good");
  const staging = join(opts.txDir, `staging-${operationId}`);
  const packageStage = join(opts.txDir, `package-${operationId}`);
  const backup = `${opts.profileDir}.center-backup`;
  const desiredEnabled =
    opts.action === "disable" || opts.action === "install"
      ? false
      : opts.action === "enable"
        ? true
        : opts.previousEnabled;
  const previousPresent = opts.previousPresent ?? true;
  const journal: TransactionJournal = {
    schema: 3,
    operationId,
    phase: "staging",
    id: opts.entry.id,
    action: opts.action,
    previousEnabled: opts.previousEnabled,
    previousPresent,
    version: opts.entry.version,
    activation: {
      expectedPresent: true,
      expectedEnabled: desiredEnabled,
      outcome: "pending",
      observations: [],
    },
    ...(opts.action === "update" ||
    opts.action === "enable" ||
    opts.action === "install"
      ? { packageSha256: opts.entry.sha256 }
      : {}),
  };
  let activeTrace = journal.activation;
  const observeActual = (observation: PluginActivationObservation): void => {
    const previous = activeTrace.observations.at(-1);
    if (
      previous?.present === observation.present &&
      previous.enabled === observation.enabled &&
      previous.phase === observation.phase
    ) {
      activeTrace.finalReadback = observation;
      return;
    }
    activeTrace.observations.push(observation);
    if (activeTrace.observations.length > 32) activeTrace.observations.shift();
    activeTrace.finalReadback = observation;
    atomicJournal(journalPath, journal);
  };
  writeFileSync(lock, operationId, { mode: 0o600, flag: "wx" });
  let swapped = false;
  try {
    rmSync(staging, { recursive: true, force: true });
    rmSync(packageStage, { recursive: true, force: true });
    const lastGoodNext = join(opts.txDir, `last-good-next-${operationId}`);
    rmSync(lastGoodNext, { recursive: true, force: true });
    journal.lastGoodPhase = "snapshot";
    atomicJournal(journalPath, journal);
    copyDir(opts.profileDir, lastGoodNext);
    journal.lastGoodPhase = "snapshot-ready";
    atomicJournal(journalPath, journal);
    if (!existsSync(lastGood)) {
      renameSync(lastGoodNext, lastGood);
    }
    atomicJournal(journalPath, journal);
    copyDir(opts.profileDir, staging);
    const patchPath = join(staging, "cordis.patch.yml");
    if (!existsSync(patchPath)) {
      throw new PenglaiError("STORE_CORRUPT", "cordis.patch.yml missing");
    }
    const nextPatch = upsertPatchDisabled(
      readFileSync(patchPath, "utf8"),
      opts.entry.id,
      !desiredEnabled,
    );
    atomicPrivateText(patchPath, nextPatch);
    const scoped = join(staging, "node_modules", ...opts.entry.id.split("/"));
    if (
      opts.action === "update" ||
      opts.action === "install" ||
      (opts.action === "enable" && !existsSync(scoped))
    ) {
      const packageFile = join(opts.pluginsDir, opts.entry.packageFile);
      if (!isUnder(opts.pluginsDir, packageFile)) {
        throw new PenglaiError(
          "SECURITY_POLICY",
          "plugin package escaped catalog root",
        );
      }
      const verified = readVerifiedPackage(packageFile, opts.entry.sha256);
      mkdirSync(packageStage, { recursive: true, mode: 0o700 });
      const archiveFiles = extractTarGz(verified.bytes, packageStage);
      const packageRoot = await verifyExtractedPackage(
        packageStage,
        opts.entry,
        false,
        archiveFiles,
      );
      rmSync(scoped, { recursive: true, force: true });
      copyDir(packageRoot, scoped);
      await verifyExtractedPackage(scoped, opts.entry, true, archiveFiles);
    } else if (opts.action === "enable") {
      const packageFile = join(opts.pluginsDir, opts.entry.packageFile);
      if (!isUnder(opts.pluginsDir, packageFile)) {
        throw new PenglaiError(
          "SECURITY_POLICY",
          "plugin package escaped catalog root",
        );
      }
      const verified = readVerifiedPackage(packageFile, opts.entry.sha256);
      const archiveFiles = inspectTarGz(verified.bytes);
      await verifyExtractedPackage(scoped, opts.entry, true, archiveFiles);
    }
    journal.phase = "activating";
    atomicJournal(journalPath, journal);
    rmSync(backup, { recursive: true, force: true });
    renameSync(opts.profileDir, backup);
    try {
      renameSync(staging, opts.profileDir);
      swapped = true;
    } catch (error) {
      renameSync(backup, opts.profileDir);
      throw error;
    }
    await opts.applyLive({
      id: opts.entry.id,
      enabled: desiredEnabled,
      forceReload: opts.action === "update",
      present: true,
    });
    journal.phase = "verifying";
    atomicJournal(journalPath, journal);
    await opts.verifyActual(
      {
        id: opts.entry.id,
        enabled: desiredEnabled,
        present: true,
      },
      observeActual,
    );
    journal.activation.outcome = "verified";
    atomicJournal(journalPath, journal);
    if (!desiredEnabled) {
      if (!opts.readResources) {
        throw new PenglaiError(
          "DSH_UNAVAILABLE",
          `${opts.entry.id} resource probe missing`,
        );
      }
      assertResourceZero(opts.readResources());
    }
    opts.commitDesired(desiredEnabled);
    journal.phase = "committed";
    atomicJournal(journalPath, journal);
    rmSync(backup, { recursive: true, force: true });
    if (existsSync(lastGoodNext)) {
      const lastGoodPrev = join(opts.txDir, `last-good-prev-${operationId}`);
      journal.lastGoodPhase = "promote-prev";
      atomicJournal(journalPath, journal);
      if (existsSync(lastGood)) renameSync(lastGood, lastGoodPrev);
      journal.lastGoodPhase = "promote-next";
      atomicJournal(journalPath, journal);
      renameSync(lastGoodNext, lastGood);
      journal.lastGoodPhase = "promote-done";
      atomicJournal(journalPath, journal);
      if (existsSync(lastGood)) rmSync(lastGoodPrev, { recursive: true, force: true });
    }
    return {
      phase: "committed",
      id: opts.entry.id,
      action: opts.action,
      operationId,
      version: opts.entry.version,
      restartRequired: opts.action === "update",
    };
  } catch (error) {
    if (journal.activation.outcome === "pending") {
      journal.activation.outcome =
        error instanceof PenglaiError && error.message === "PLUGIN_ACTIVATION_TIMEOUT"
          ? "timed_out"
          : "failed";
    }
    journal.failureCode = pluginActionFailureCode(error);
    journal.rollback = {
      expectedPresent: previousPresent,
      expectedEnabled: opts.previousEnabled,
      outcome: "pending",
      observations: [],
    };
    activeTrace = journal.rollback;
    atomicJournal(journalPath, journal);
    try {
      if (swapped && existsSync(backup)) {
        const failed = `${opts.profileDir}.failed-${operationId}`;
        renameSync(opts.profileDir, failed);
        renameSync(backup, opts.profileDir);
        rmSync(failed, { recursive: true, force: true });
      }
      await opts.applyLive({
        id: opts.entry.id,
        enabled: opts.previousEnabled,
        forceReload: opts.action === "update",
        present: previousPresent,
      });
      await opts.verifyActual(
        {
          id: opts.entry.id,
          enabled: opts.previousEnabled,
          present: previousPresent,
        },
        observeActual,
      );
      opts.rollbackDesired(opts.previousEnabled);
      journal.rollback.outcome = "verified";
    } catch (rollbackError) {
      journal.rollback.outcome = "failed";
      journal.failureCode = "PLUGIN_ROLLBACK_FAILED";
      throw new AggregateError(
        [error, rollbackError],
        `Center transaction and rollback failed for ${opts.entry.id}`,
      );
    } finally {
      journal.phase = "rolled_back";
      journal.errorClass =
        error instanceof PenglaiError ? error.errorClass : "DSH_UNAVAILABLE";
      atomicJournal(journalPath, journal);
    }
    throw error;
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(packageStage, { recursive: true, force: true });
    rmSync(lock, { force: true });
  }
}

function listPrefixedDirs(txDir: string, prefix: string): string[] {
  if (!existsSync(txDir)) return [];
  return readdirSync(txDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => join(txDir, entry.name));
}

export function healLastGoodArtifacts(txDir: string): string | undefined {
  const lastGood = join(txDir, "last-good");
  if (existsSync(lastGood)) return lastGood;
  const next = listPrefixedDirs(txDir, "last-good-next-")[0];
  if (next) {
    renameSync(next, lastGood);
    return lastGood;
  }
  const prev = listPrefixedDirs(txDir, "last-good-prev-")[0];
  if (prev) {
    renameSync(prev, lastGood);
    return lastGood;
  }
  return undefined;
}

export function recoverInterruptedTransaction(opts: {
  userDataRoot: string;
  profileDir: string;
  txDir: string;
  id?: string;
}): ProfileTxResult | { phase: "idle" | "committed" } {
  assertTransactionPaths(opts);
  healLastGoodArtifacts(opts.txDir);
  const journalPath = join(opts.txDir, "journal.json");
  const lockPath = join(opts.txDir, "active.lock");
  if (!existsSync(journalPath)) {
    rmSync(lockPath, { force: true });
    return { phase: "idle" };
  }
  const raw = JSON.parse(readFileSync(journalPath, "utf8")) as {
    phase?: string;
    id?: string;
    previousEnabled?: boolean;
  };
  if (raw.phase === "committed") {
    rmSync(lockPath, { force: true });
    return { phase: "committed" };
  }
  if (["staging", "activating", "verifying"].includes(String(raw.phase))) {
    const id = opts.id ?? raw.id;
    if (!id || typeof raw.previousEnabled !== "boolean") {
      throw new PenglaiError(
        "STORE_CORRUPT",
        "Center recovery journal incomplete",
      );
    }
    const out = rollbackLastGood({ ...opts, id });
    rmSync(lockPath, { force: true });
    return { ...out, previousEnabled: raw.previousEnabled };
  }
  rmSync(lockPath, { force: true });
  return { phase: "idle" };
}

export function rollbackLastGood(opts: {
  userDataRoot: string;
  profileDir: string;
  txDir: string;
  id: string;
}): ProfileTxResult {
  assertTransactionPaths(opts);
  const lastGood = healLastGoodArtifacts(opts.txDir) ?? join(opts.txDir, "last-good");
  if (!existsSync(lastGood)) {
    throw new PenglaiError("STORE_CORRUPT", "last-good missing");
  }
  const staging = join(opts.txDir, `rollback-${randomUUID()}`);
  const backup = `${opts.profileDir}.rollback-backup`;
  const activationBackup = `${opts.profileDir}.center-backup`;
  copyDir(lastGood, staging);
  rmSync(backup, { recursive: true, force: true });
  if (existsSync(opts.profileDir)) renameSync(opts.profileDir, backup);
  try {
    renameSync(staging, opts.profileDir);
    rmSync(backup, { recursive: true, force: true });
    rmSync(activationBackup, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(opts.profileDir) && existsSync(backup)) {
      renameSync(backup, opts.profileDir);
    }
    throw error;
  }
  const journalPath = join(opts.txDir, "journal.json");
  if (existsSync(journalPath)) {
    const raw = JSON.parse(readFileSync(journalPath, "utf8")) as Record<
      string,
      unknown
    >;
    atomicJournal(journalPath, { ...raw, phase: "rolled_back" });
  }
  return { phase: "rolled_back", id: opts.id, action: "rollback" };
}
