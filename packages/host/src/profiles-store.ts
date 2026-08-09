/**
 * Persisted model profiles (BYOK) — the host's private config file.
 *
 * `<data-dir>/profiles.json` (0o600) holds the profiles created by the
 * first-run setup wizard and `penglai config add`, so a configured key
 * survives host restarts. Two key styles:
 *
 *   - literal:  `apiKey` stored in the file (0600, loopback-only host);
 *   - reference: `apiKeyEnv` naming an environment variable the host
 *     resolves at runtime (no key material on disk).
 *
 * On boot the persisted entries are merged over the built-in catalog
 * (same id wins), and literal keys seed the host's in-memory key map.
 * The file is written atomically (tmp + rename) and never leaves the
 * data dir.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { assertSafeProviderBaseUrl } from "./providers/url-safety.js";

/** One persisted profile entry (the on-disk shape). */
export interface PersistedProfileEntry {
  id: string;
  label: string;
  provider: string;
  baseUrl: string;
  model: string;
  /** Env var the host resolves the key from ("" when using a literal key). */
  apiKeyEnv: string;
  /** Literal key material; present only when the owner stored it. */
  apiKey?: string;
  /** Context window tokens (catalog or owner override). */
  contextWindowTokens?: number | null;
  /** Max output tokens when known. */
  maxOutputTokens?: number | null;
  capabilities?: {
    tools?: boolean;
    streaming?: boolean;
    vision?: boolean;
  };
}

interface ProfilesFile {
  schemaVersion: 1;
  profiles: PersistedProfileEntry[];
}

export function profilesFilePath(dataDir: string): string {
  return path.join(dataDir, "profiles.json");
}

function isValidEntry(entry: unknown): entry is PersistedProfileEntry {
  const e = entry as PersistedProfileEntry;
  const shapeOk = (
    !!e &&
    typeof e === "object" &&
    typeof e.id === "string" &&
    e.id.length > 0 &&
    typeof e.baseUrl === "string" &&
    e.baseUrl.length > 0 &&
    typeof e.model === "string" &&
    e.model.length > 0
  );
  if (!shapeOk) return false;
  try {
    assertSafeProviderBaseUrl(e.baseUrl);
    return true;
  } catch {
    return false;
  }
}

/** Load persisted profiles; tolerant of a missing or corrupt file. */
export function loadPersistedProfiles(dataDir: string): PersistedProfileEntry[] {
  const file = profilesFilePath(dataDir);
  let parsed: ProfilesFile;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as ProfilesFile;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.profiles)) return [];
  return parsed.profiles.filter(isValidEntry).map((entry) => ({
    id: entry.id,
    label: typeof entry.label === "string" && entry.label ? entry.label : `${entry.model} @ ${entry.baseUrl}`,
    provider: typeof entry.provider === "string" && entry.provider ? entry.provider : "custom",
    baseUrl: assertSafeProviderBaseUrl(entry.baseUrl),
    model: entry.model,
    apiKeyEnv: typeof entry.apiKeyEnv === "string" ? entry.apiKeyEnv : "",
    ...(typeof entry.apiKey === "string" && entry.apiKey ? { apiKey: entry.apiKey } : {}),
    ...(typeof entry.contextWindowTokens === "number" && entry.contextWindowTokens > 0
      ? { contextWindowTokens: Math.floor(entry.contextWindowTokens) }
      : {}),
    ...(typeof entry.maxOutputTokens === "number" && entry.maxOutputTokens > 0
      ? { maxOutputTokens: Math.floor(entry.maxOutputTokens) }
      : {}),
    ...(entry.capabilities && typeof entry.capabilities === "object"
      ? { capabilities: entry.capabilities }
      : {}),
  }));
}

/**
 * Upsert one profile entry and rewrite the file atomically with 0600
 * permissions (the file carries key material). Returns the file path.
 */
export function savePersistedProfile(
  dataDir: string,
  entry: PersistedProfileEntry,
): string {
  const safeBaseUrl = assertSafeProviderBaseUrl(entry.baseUrl);
  const profiles = loadPersistedProfiles(dataDir).filter((p) => p.id !== entry.id);
  profiles.push({
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    baseUrl: safeBaseUrl,
    model: entry.model,
    apiKeyEnv: entry.apiKeyEnv,
    ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
    ...(typeof entry.contextWindowTokens === "number"
      ? { contextWindowTokens: entry.contextWindowTokens }
      : {}),
    ...(typeof entry.maxOutputTokens === "number"
      ? { maxOutputTokens: entry.maxOutputTokens }
      : {}),
    ...(entry.capabilities ? { capabilities: entry.capabilities } : {}),
  });
  const file = profilesFilePath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  const payload: ProfilesFile = { schemaVersion: 1, profiles };
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best-effort permission hardening */
  }
  return file;
}
