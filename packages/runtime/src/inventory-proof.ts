import { PenglaiError } from "@penglai/contracts";
import { FIRST_PARTY_PLUGIN_METADATA, PINNED_PLUGIN_DSH } from "./plugin-catalog.js";

export const REQUIRED_INVENTORY_IDS = [
  "@deepseek-ai/dsh-credentials-local",
  "@penglai/plugin-center",
  "@penglai/office",
  "@penglai/memory",
] as const;

export const FORBIDDEN_LOADED_PLUGIN_IDS = [
  "@penglai/plugin-smoke",
  "@penglai/credentials-keychain",
] as const;

export const OPTIONAL_IM_PLUGIN_ID = "@penglai/im" as const;

export type RequiredInventoryId = (typeof REQUIRED_INVENTORY_IDS)[number];
export type InventoryPluginSource = "builtin" | "catalog";
export type InventoryPluginHealth = "ready" | "degraded" | "failed";

export interface InventoryEntry {
  entryId?: string;
  moduleName?: string;
  name?: string;
  id?: string;
  enabled?: boolean;
  disabled?: boolean;
  fiberPhase?: string | null;
  version?: string;
  source?: string;
  health?: string;
  healthy?: boolean;
  digest?: string;
}

export interface InventorySnapshot {
  at?: string;
  launchNonce?: string;
  dshPid?: number;
  entries: InventoryEntry[];
  requiredProofs?: RequiredPluginProof[];
}

export interface RequiredPluginProof {
  id: string;
  version: string;
  source: InventoryPluginSource;
  enabled: boolean;
  active: boolean;
  health: InventoryPluginHealth;
  digest?: string;
}

export interface InventoryProof {
  ok: boolean;
  credentials: boolean;
  pluginCenter: boolean;
  office: boolean;
  memory: boolean;
  im: boolean;
  smokeDisabled: boolean;
  required: RequiredPluginProof[];
  entries: InventoryEntry[];
}

export const EMPTY_INVENTORY_PROOF: InventoryProof = {
  ok: false,
  credentials: false,
  pluginCenter: false,
  office: false,
  memory: false,
  im: false,
  smokeDisabled: false,
  required: REQUIRED_INVENTORY_IDS.map((id) => missingRequiredProof(id)),
  entries: [],
};

const PENGLAI_SCOPE = "@penglai/";
const DEEPSEEK_SCOPE = "@deepseek-ai/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRequiredId(id: string): id is RequiredInventoryId {
  return (REQUIRED_INVENTORY_IDS as readonly string[]).includes(id);
}

function isHealth(value: unknown): value is InventoryPluginHealth {
  return value === "ready" || value === "degraded" || value === "failed";
}

function isSource(value: unknown): value is InventoryPluginSource {
  return value === "builtin" || value === "catalog";
}

function worseHealth(left: InventoryPluginHealth, right: InventoryPluginHealth): InventoryPluginHealth {
  const rank = { ready: 0, degraded: 1, failed: 2 };
  return rank[left] >= rank[right] ? left : right;
}

function officialAliases(id: string): string[] {
  const aliases = [id];
  if (id.startsWith(PENGLAI_SCOPE)) aliases.push(`penglai-${id.slice(PENGLAI_SCOPE.length)}`);
  if (id.startsWith(DEEPSEEK_SCOPE)) aliases.push(id.slice(DEEPSEEK_SCOPE.length));
  return aliases;
}

function fieldEqualsId(field: string | undefined, id: string): boolean {
  if (typeof field !== "string" || field.length === 0) return false;
  return officialAliases(id).includes(field);
}

export function refuseRequiredPluginDisable(pluginId: string): void {
  const row = { id: pluginId, moduleName: pluginId, name: pluginId };
  if (REQUIRED_INVENTORY_IDS.some((id) => exactPluginId(row, id))) {
    throw new PenglaiError("SECURITY_POLICY", "required plugin cannot be disabled");
  }
}

export function exactPluginId(row: InventoryEntry, id: string): boolean {
  if (typeof id !== "string" || id.length === 0) return false;
  if (fieldEqualsId(row.moduleName, id) || fieldEqualsId(row.name, id) || fieldEqualsId(row.id, id)) {
    return true;
  }
  if (typeof row.entryId !== "string" || row.entryId.length === 0) return false;
  const tail = row.entryId.split(":").at(-1);
  return fieldEqualsId(tail, id);
}

export function matchesPlugin(row: InventoryEntry, ids: string[]): boolean {
  return ids.some((id) => exactPluginId(row, id));
}

export function rowIsLoaded(row: InventoryEntry | undefined): boolean {
  if (!row) return false;
  if (row.disabled === true || row.enabled === false) return false;
  return row.fiberPhase === "active";
}

export function normalizeInventory(raw: unknown): InventoryEntry[] {
  if (Array.isArray(raw)) return raw as InventoryEntry[];
  if (raw && typeof raw === "object" && "entries" in raw) {
    const entries = (raw as { entries?: InventoryEntry[] }).entries;
    return Array.isArray(entries) ? entries : [];
  }
  return [];
}

function catalogVersion(id: string): string {
  if (id === "@deepseek-ai/dsh-credentials-local") return PINNED_PLUGIN_DSH;
  return FIRST_PARTY_PLUGIN_METADATA.find((entry) => entry.id === id)?.version ?? "";
}

function catalogSource(id: string): InventoryPluginSource {
  const source = FIRST_PARTY_PLUGIN_METADATA.find((entry) => entry.id === id)?.source;
  return source === "penglai-plugin-registry" ? "catalog" : "builtin";
}

function missingRequiredProof(id: RequiredInventoryId): RequiredPluginProof {
  return {
    id,
    version: "",
    source: catalogSource(id),
    enabled: false,
    active: false,
    health: "failed",
  };
}

function pluginEnabled(row: InventoryEntry): boolean {
  return row.disabled !== true && row.enabled !== false;
}

function pluginActive(row: InventoryEntry): boolean {
  return row.fiberPhase === "active";
}

function rowVersion(row: InventoryEntry, id: string): string {
  if (typeof row.version === "string" && row.version.trim().length > 0) return row.version.trim();
  return catalogVersion(id);
}

function rowSource(row: InventoryEntry, id: string): InventoryPluginSource {
  if (isSource(row.source)) return row.source;
  if (row.source === "penglai-plugin-registry") return "catalog";
  if (row.source === "bundled-first-party") return "builtin";
  return catalogSource(id);
}

function rowDigest(row: InventoryEntry): string | undefined {
  return typeof row.digest === "string" && row.digest.length > 0 ? row.digest : undefined;
}

function deriveHealth(
  row: InventoryEntry,
  enabled: boolean,
  active: boolean,
  version: string,
): InventoryPluginHealth {
  if (!enabled || !active) return "failed";
  if (row.healthy === false) return "failed";
  const stated = isHealth(row.health) ? row.health : undefined;
  if (stated === "failed") return "failed";
  if (!version) return "degraded";
  return stated ?? "ready";
}

function deriveProof(id: RequiredInventoryId, entries: InventoryEntry[]): RequiredPluginProof {
  const hits = entries.filter((row) => exactPluginId(row, id));
  const row = hits.length === 1 ? hits[0] : undefined;
  if (!row) return missingRequiredProof(id);
  const enabled = pluginEnabled(row);
  const active = pluginActive(row);
  const version = rowVersion(row, id);
  const digest = rowDigest(row);
  return {
    id,
    version,
    source: rowSource(row, id),
    enabled,
    active,
    health: deriveHealth(row, enabled, active, version),
    ...(digest ? { digest } : {}),
  };
}

function parseRequiredProof(value: unknown): RequiredPluginProof | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || !isRequiredId(value.id)) return undefined;
  if (typeof value.version !== "string") return undefined;
  if (!isSource(value.source) || !isHealth(value.health)) return undefined;
  if (typeof value.enabled !== "boolean" || typeof value.active !== "boolean") return undefined;
  if (value.digest !== undefined && typeof value.digest !== "string") return undefined;
  return {
    id: value.id,
    version: value.version,
    source: value.source,
    enabled: value.enabled,
    active: value.active,
    health: value.health,
    ...(value.digest ? { digest: value.digest } : {}),
  };
}

function statedProofs(raw: unknown): Map<string, RequiredPluginProof> {
  const found = new Map<string, RequiredPluginProof>();
  if (!isRecord(raw) || !Array.isArray(raw.requiredProofs)) return found;
  const seen = new Set<string>();
  for (const item of raw.requiredProofs) {
    const parsed = parseRequiredProof(item);
    if (!parsed) continue;
    if (seen.has(parsed.id)) {
      found.set(parsed.id, missingRequiredProof(parsed.id as RequiredInventoryId));
      continue;
    }
    seen.add(parsed.id);
    found.set(parsed.id, parsed);
  }
  return found;
}

function mergeProof(derived: RequiredPluginProof, stated: RequiredPluginProof | undefined): RequiredPluginProof {
  if (!stated || stated.id !== derived.id) return derived;
  const digest = stated.digest ?? derived.digest;
  return {
    id: derived.id,
    version: stated.version || derived.version,
    source: stated.source,
    enabled: derived.enabled,
    active: derived.active,
    health: worseHealth(stated.health, derived.health),
    ...(digest ? { digest } : {}),
  };
}

function proofReady(proof: RequiredPluginProof): boolean {
  return (
    proof.id.length > 0 &&
    proof.version.length > 0 &&
    proof.enabled &&
    proof.active &&
    proof.health === "ready"
  );
}

function readyById(required: RequiredPluginProof[], id: RequiredInventoryId): boolean {
  const row = required.find((item) => item.id === id);
  return row ? proofReady(row) : false;
}

export function evaluateInventory(raw: unknown): InventoryProof {
  const entries = normalizeInventory(raw);
  const stated = statedProofs(raw);
  const required = REQUIRED_INVENTORY_IDS.map((id) => mergeProof(deriveProof(id, entries), stated.get(id)));
  const credentials = readyById(required, "@deepseek-ai/dsh-credentials-local");
  const pluginCenter = readyById(required, "@penglai/plugin-center");
  const office = readyById(required, "@penglai/office");
  const memory = readyById(required, "@penglai/memory");
  const im = entries.some((row) => exactPluginId(row, OPTIONAL_IM_PLUGIN_ID) && rowIsLoaded(row));
  const smokeLoaded = entries.some((row) => exactPluginId(row, "@penglai/plugin-smoke") && rowIsLoaded(row));
  const forbiddenLoaded = FORBIDDEN_LOADED_PLUGIN_IDS.some((id) =>
    entries.some((row) => exactPluginId(row, id) && rowIsLoaded(row)),
  );
  return {
    ok: credentials && pluginCenter && office && memory && !forbiddenLoaded,
    credentials,
    pluginCenter,
    office,
    memory,
    im,
    smokeDisabled: !smokeLoaded,
    required,
    entries,
  };
}

export function inventorySnapshotDocument(
  entries: InventoryEntry[],
  at = new Date().toISOString(),
): InventorySnapshot & { required: Record<string, boolean>; ok: boolean } {
  const proof = evaluateInventory({ entries });
  return {
    at,
    entries,
    required: {
      credentials: proof.credentials,
      "plugin-center": proof.pluginCenter,
      office: proof.office,
      memory: proof.memory,
      im: proof.im,
      smokeDisabled: proof.smokeDisabled,
    },
    requiredProofs: proof.required,
    ok: proof.ok,
  };
}
