import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import {
  DATA_CATEGORIES,
  assertCanonicalManifestUrl,
  resolveGenerationLayout,
  type DataCategory,
  type GenerationLayout,
  type ManagedDataLayout,
} from "@penglai/runtime";

export const COMPLETE_DELETE_PHRASE = "DELETE PENGLAI DATA";

export interface DesktopDataLayout extends GenerationLayout {
  managedData: ManagedDataLayout;
  updateBackups: string;
  sessionData: string;
}

export interface ElectronPathHost {
  setName(name: string): void;
  getPath(name: string): string;
  setPath(name: string, path: string): void;
  setAppLogsPath(path?: string): void;
}

export function configureGenerationPaths(input: {
  app: ElectronPathHost;
  platform: "darwin" | "win32";
  envUserData?: string;
  localAppData?: string;
}): DesktopDataLayout {
  input.app.setName("Penglai");
  const generation = resolveGenerationLayout({
    platform: input.platform,
    ...(input.platform === "win32" && input.localAppData ? { localAppData: input.localAppData } : {}),
  });
  if (input.envUserData && !isAbsolute(input.envUserData)) {
    throw new PenglaiError("SECURITY_POLICY", "PENGLAI_USER_DATA must be absolute");
  }
  const userData = resolve(input.envUserData ?? generation.userData);
  const cache = input.envUserData ? join(userData, "cache") : generation.cache;
  const updates = input.envUserData ? join(cache, "updates") : generation.updates;
  const logs = input.envUserData ? join(userData, "logs") : generation.logs;
  const sessionData = join(cache, "chromium-session");
  for (const path of [userData, cache, updates, logs, sessionData]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  input.app.setPath("userData", userData);
  input.app.setPath("cache", cache);
  input.app.setPath("sessionData", sessionData);
  input.app.setAppLogsPath(logs);
  return {
    ...generation,
    userData,
    dshHome: join(userData, "dsh-home"),
    logs,
    cache,
    updates,
    im: join(userData, "im"),
    uninstall: join(userData, "uninstall"),
    managedData: { userData, cacheRoot: cache, logsRoot: logs },
    updateBackups: join(userData, "update-backups"),
    sessionData,
  };
}

export function releaseTarget(platform: NodeJS.Platform, arch: string): string {
  if (platform === "darwin" && arch === "arm64") return "darwin-aarch64";
  if (platform === "darwin" && arch === "x64") return "darwin-x86_64";
  if (platform === "win32" && arch === "x64") return "windows-x86_64";
  throw new PenglaiError("SECURITY_POLICY", `unsupported installed update target ${platform}/${arch}`);
}

export interface UpdaterReleaseContract {
  version: string;
  updaterChannel: "desktop-v0.5";
  updaterPublicKeyId: string;
  updaterPublicKeyHex: string;
  updaterManifestUrl: string;
  updaterManifestSignatureUrl: string;
  updaterAllowedAssetHosts: string[];
}

export function loadUpdaterReleaseContract(resourcesRoot: string): UpdaterReleaseContract {
  const path = join(resourcesRoot, "release-contract.json");
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) {
    throw new PenglaiError("STORE_CORRUPT", "embedded release contract missing or unsafe");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new PenglaiError("STORE_CORRUPT", "embedded release contract unreadable");
  }
  const value = raw as Partial<UpdaterReleaseContract>;
  if (
    typeof value.version !== "string" ||
    !/^0\.5\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(value.version) ||
    value.updaterChannel !== "desktop-v0.5" ||
    typeof value.updaterPublicKeyId !== "string" ||
    value.updaterPublicKeyId.length < 8 ||
    typeof value.updaterPublicKeyHex !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.updaterPublicKeyHex) ||
    typeof value.updaterManifestUrl !== "string" ||
    typeof value.updaterManifestSignatureUrl !== "string" ||
    !Array.isArray(value.updaterAllowedAssetHosts) ||
    value.updaterAllowedAssetHosts.length !== 1 ||
    value.updaterAllowedAssetHosts[0] !== "github.com"
  ) {
    throw new PenglaiError("STORE_CORRUPT", "embedded updater contract invalid");
  }
  assertCanonicalManifestUrl(value.updaterManifestUrl, value.updaterManifestUrl);
  assertCanonicalManifestUrl(value.updaterManifestSignatureUrl, value.updaterManifestSignatureUrl);
  return value as UpdaterReleaseContract;
}

export interface WorkspaceProtection {
  roots: string[];
  snapshotAt: string;
}

export function readWorkspaceProtection(
  path: string,
  now = Date.now(),
  maxAgeMs = 10_000,
): WorkspaceProtection {
  if (!existsSync(path)) throw new PenglaiError("DSH_UNAVAILABLE", "official Workspace protection snapshot missing");
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new PenglaiError("SECURITY_POLICY", "Workspace protection snapshot must be a regular file");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new PenglaiError("STORE_CORRUPT", "Workspace protection snapshot unreadable");
  }
  const value = raw as { schema?: unknown; complete?: unknown; at?: unknown; roots?: unknown };
  const at = typeof value.at === "string" ? Date.parse(value.at) : Number.NaN;
  if (
    value.schema !== 1 ||
    value.complete !== true ||
    !Number.isFinite(at) ||
    at > now + 5_000 ||
    now - at > maxAgeMs ||
    !Array.isArray(value.roots) ||
    value.roots.some((root) => typeof root !== "string" || !isAbsolute(root))
  ) {
    throw new PenglaiError("SECURITY_POLICY", "Workspace protection snapshot incomplete or stale");
  }
  const roots = [...new Set(value.roots.map((root) => resolve(String(root))))].sort();
  return { roots, snapshotAt: new Date(at).toISOString() };
}

export function assertCompleteDeletePhrase(value: unknown): void {
  if (value !== COMPLETE_DELETE_PHRASE) {
    throw new PenglaiError("SECURITY_POLICY", "complete delete confirmation phrase mismatch");
  }
}

export interface DeletionPrepareRequest {
  categories: DataCategory[];
  confirmCredentials: boolean;
  confirmSensitive: boolean;
  completeDeletePhrase?: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PenglaiError("INVALID_INPUT", "IPC payload must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new PenglaiError("INVALID_INPUT", "IPC payload contains an unknown field");
  }
}

export function parseDeletionPrepareRequest(value: unknown): DeletionPrepareRequest {
  const input = record(value);
  exactKeys(input, ["categories", "confirmCredentials", "confirmSensitive", "completeDeletePhrase"]);
  if (!Array.isArray(input.categories) || input.categories.length < 1) {
    throw new PenglaiError("INVALID_INPUT", "at least one data category is required");
  }
  const categories = input.categories.map((category) => {
    if (typeof category !== "string" || !(DATA_CATEGORIES as readonly string[]).includes(category)) {
      throw new PenglaiError("INVALID_INPUT", "unknown data category");
    }
    return category as DataCategory;
  });
  if (new Set(categories).size !== categories.length) {
    throw new PenglaiError("INVALID_INPUT", "duplicate data category");
  }
  if (typeof input.confirmCredentials !== "boolean" || typeof input.confirmSensitive !== "boolean") {
    throw new PenglaiError("INVALID_INPUT", "explicit deletion confirmations are required");
  }
  const complete = DATA_CATEGORIES.every((category) => categories.includes(category));
  if (complete) assertCompleteDeletePhrase(input.completeDeletePhrase);
  if (input.completeDeletePhrase !== undefined && typeof input.completeDeletePhrase !== "string") {
    throw new PenglaiError("INVALID_INPUT", "complete delete phrase must be text");
  }
  return {
    categories,
    confirmCredentials: input.confirmCredentials,
    confirmSensitive: input.confirmSensitive,
    ...(typeof input.completeDeletePhrase === "string"
      ? { completeDeletePhrase: input.completeDeletePhrase }
      : {}),
  };
}

export function parseConfirmedRequest(value: unknown): { confirmed: true } {
  const input = record(value);
  exactKeys(input, ["confirmed"]);
  if (input.confirmed !== true) {
    throw new PenglaiError("SECURITY_POLICY", "explicit confirmation is required");
  }
  return { confirmed: true };
}

export function parseOperationRequest(value: unknown, requireConfirmed = false): {
  operationId: string;
  confirmed?: true;
} {
  const input = record(value);
  exactKeys(input, requireConfirmed ? ["operationId", "confirmed"] : ["operationId"]);
  if (typeof input.operationId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(input.operationId)) {
    throw new PenglaiError("INVALID_INPUT", "invalid operation id");
  }
  if (requireConfirmed && input.confirmed !== true) {
    throw new PenglaiError("SECURITY_POLICY", "explicit execution confirmation is required");
  }
  return {
    operationId: input.operationId,
    ...(requireConfirmed ? { confirmed: true as const } : {}),
  };
}

export function installedApplicationPath(execPath: string, platform: NodeJS.Platform): string {
  if (!isAbsolute(execPath)) throw new PenglaiError("SECURITY_POLICY", "application path must be absolute");
  const normalized = resolve(execPath);
  if (platform !== "darwin") return normalized;
  const marker = ".app/Contents/MacOS/";
  const index = normalized.indexOf(marker);
  return index >= 0 ? `${normalized.slice(0, index)}.app` : normalized;
}
