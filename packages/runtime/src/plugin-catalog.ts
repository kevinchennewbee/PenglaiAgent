import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { PenglaiError } from "@penglai/contracts";

export const PLUGIN_CATALOG_SCHEMA = 3 as const;
export const PINNED_PLUGIN_DSH = "0.1.2-alpha.1" as const;
export const PRODUCT_PLUGIN_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
] as const;

export type ProductPluginTarget = (typeof PRODUCT_PLUGIN_TARGETS)[number];
export type PluginProvenanceClass =
  | "official-core"
  | "penglai-builtin"
  | "penglai-first-party"
  | "community-reviewed";

export type PluginInstallClass =
  | "infrastructure"
  | "required-builtin"
  | "optional-first-party"
  | "community-reviewed"
  | "migration"
  | "advanced-first-party"
  | "internal-test";

export type PluginUpdatePolicy = "signed-overlay" | "app-only";
export type PluginResourcePolicy =
  | "none"
  | "optional-large-assets"
  | "bundled-native";

export interface PluginCatalogMetadata {
  id: string;
  version: string;
  packageFile: string;
  dsh: { exact: typeof PINNED_PLUGIN_DSH };
  platforms: ProductPluginTarget[];
  capabilities: string[];
  permissions: string[];
  defaultEnabled: boolean;
  builtIn: boolean;
  source: "bundled-first-party" | "penglai-plugin-registry";
  provenanceClass: PluginProvenanceClass;
  installClass: PluginInstallClass;
  userVisible: boolean;
  updatePolicy: PluginUpdatePolicy;
  resourcePolicy: PluginResourcePolicy;
  license: string;
  migration: string;
  rollback: "last-good-profile";
}

export interface PluginCatalogEntry extends PluginCatalogMetadata {
  sha256: string;
  target: ProductPluginTarget;
  hasClient: boolean;
  entry?: string;
  clientEntry?: string;
  networkOrigins?: string[];
  dataPaths?: string[];
  nativeCode?: boolean;
  publisher?: string;
}

export interface PluginCatalogDocument {
  schema: typeof PLUGIN_CATALOG_SCHEMA;
  target: ProductPluginTarget;
  entries: PluginCatalogEntry[];
}

export interface EmbeddedPluginManifest {
  schema: 1;
  id: string;
  dshExact: string;
  target: ProductPluginTarget;
  platforms: ProductPluginTarget[];
  capabilities: string[];
  permissions: string[];
  source: string;
  provenanceClass: PluginProvenanceClass;
  license: string;
  migration: string;
  rollback: string;
}

const TARGETS = [...PRODUCT_PLUGIN_TARGETS];
const common = {
  version: "0.5.8",
  dsh: { exact: PINNED_PLUGIN_DSH },
  platforms: TARGETS,
  source: "bundled-first-party" as const,
  license: "MIT",
  migration: "none",
  rollback: "last-good-profile" as const,
  updatePolicy: "signed-overlay" as const,
};

export const FIRST_PARTY_PLUGIN_METADATA: readonly PluginCatalogMetadata[] =
  Object.freeze([
    {
      ...common,
      id: "@penglai/plugin-center",
      packageFile: "penglai-plugin-center-0.5.8.tgz",
      capabilities: ["settings-ui", "catalog", "profile-transaction"],
      permissions: ["profile-write"],
      defaultEnabled: true,
      builtIn: true,
      provenanceClass: "penglai-builtin",
      installClass: "infrastructure",
      userVisible: false,
      resourcePolicy: "none",
    },
    {
      ...common,
      id: "@penglai/im",
      packageFile: "penglai-im-0.5.8.tgz",
      capabilities: ["settings-ui", "im-weixin", "im-feishu", "private-voice"],
      permissions: ["credentials-service", "local-database", "outbound-network"],
      defaultEnabled: false,
      builtIn: true,
      provenanceClass: "penglai-builtin",
      installClass: "optional-first-party",
      userVisible: true,
      resourcePolicy: "none",
    },
    {
      ...common,
      id: "@penglai/plugin-reference",
      packageFile: "penglai-plugin-reference-0.5.8.tgz",
      capabilities: ["platform-proof"],
      permissions: [],
      defaultEnabled: false,
      builtIn: true,
      provenanceClass: "penglai-builtin",
      installClass: "internal-test",
      userVisible: false,
      resourcePolicy: "none",
    },
    {
      ...common,
      id: "@penglai/asr",
      packageFile: "penglai-asr-0.5.8.tgz",
      capabilities: ["settings-ui", "local-asr", "model-manager"],
      permissions: ["microphone", "local-model"],
      defaultEnabled: false,
      builtIn: true,
      provenanceClass: "penglai-first-party",
      installClass: "optional-first-party",
      userVisible: true,
      resourcePolicy: "optional-large-assets",
    },
    {
      ...common,
      id: "@penglai/moss-tts",
      packageFile: "penglai-moss-tts-0.5.8.tgz",
      capabilities: ["settings-ui", "local-tts", "model-manager"],
      permissions: ["local-model", "audio-output"],
      defaultEnabled: false,
      builtIn: true,
      provenanceClass: "penglai-first-party",
      installClass: "optional-first-party",
      userVisible: true,
      resourcePolicy: "optional-large-assets",
    },
    {
      ...common,
      id: "@penglai/memory",
      packageFile: "penglai-memory-0.5.8.tgz",
      capabilities: [
        "layered-memory",
        "knowledge-graph",
        "authorized-sources",
        "source-cards",
        "official-skill-promotion",
      ],
      permissions: [
        "local-memory",
        "local-index",
        "authorized-files-read",
        "official-skill-write",
      ],
      defaultEnabled: true,
      builtIn: true,
      provenanceClass: "penglai-builtin",
      installClass: "required-builtin",
      userVisible: true,
      resourcePolicy: "none",
    },
    {
      ...common,
      id: "@penglai/office",
      packageFile: "penglai-office-0.5.8.tgz",
      capabilities: ["office-edit", "docx", "xlsx", "pptx", "pdf"],
      permissions: ["workspace-read", "workspace-write"],
      defaultEnabled: true,
      builtIn: true,
      provenanceClass: "penglai-builtin",
      installClass: "required-builtin",
      userVisible: true,
      resourcePolicy: "none",
    },
    {
      ...common,
      id: "@penglai/budget",
      packageFile: "penglai-budget-0.5.8.tgz",
      capabilities: ["token-budget", "pre-invocation-gate"],
      permissions: ["token-meter", "model-invocation-gate"],
      defaultEnabled: false,
      builtIn: true,
      provenanceClass: "penglai-first-party",
      installClass: "advanced-first-party",
      userVisible: false,
      resourcePolicy: "none",
    },
    {
      ...common,
      id: "@penglai/companion",
      packageFile: "penglai-companion-0.5.8.tgz",
      capabilities: ["proactive-companion", "schedule-composition"],
      permissions: ["schedule", "dedicated-agent", "im-send"],
      defaultEnabled: false,
      builtIn: true,
      provenanceClass: "penglai-first-party",
      installClass: "optional-first-party",
      userVisible: true,
      resourcePolicy: "none",
    },
  ] satisfies PluginCatalogMetadata[]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameStringArray(actual: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function assertMetadataMatch(
  raw: Record<string, unknown>,
  expected: PluginCatalogMetadata,
): void {
  for (const key of [
    "id",
    "version",
    "packageFile",
    "defaultEnabled",
    "builtIn",
    "source",
    "provenanceClass",
    "installClass",
    "userVisible",
    "updatePolicy",
    "resourcePolicy",
    "license",
    "migration",
    "rollback",
  ] as const) {
    if (raw[key] !== expected[key]) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        `${expected.id} catalog ${key} drift`,
      );
    }
  }
  const dsh = isRecord(raw.dsh) ? raw.dsh : undefined;
  if (dsh?.exact !== expected.dsh.exact) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", expected.id);
  }
  for (const key of ["platforms", "capabilities", "permissions"] as const) {
    if (!sameStringArray(raw[key], expected[key])) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        `${expected.id} catalog ${key} drift`,
      );
    }
  }
}

export function runtimePluginTarget(
  platform = process.platform,
  arch = process.arch,
): ProductPluginTarget {
  const target = `${platform}-${arch}`;
  if (!PRODUCT_PLUGIN_TARGETS.includes(target as ProductPluginTarget)) {
    throw new PenglaiError(
      "DSH_UNAVAILABLE",
      `unsupported Penglai plugin target ${target}`,
    );
  }
  return target as ProductPluginTarget;
}

export function validatePluginCatalog(
  raw: unknown,
  expectedTarget: ProductPluginTarget,
): PluginCatalogDocument {
  if (!isRecord(raw) || raw.schema !== PLUGIN_CATALOG_SCHEMA) {
    throw new PenglaiError("STORE_CORRUPT", "plugin catalog schema mismatch");
  }
  if (raw.target !== expectedTarget) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      `plugin catalog target mismatch: expected ${expectedTarget}`,
    );
  }
  if (!Array.isArray(raw.entries)) {
    throw new PenglaiError("STORE_CORRUPT", "plugin catalog entries missing");
  }
  if (raw.entries.length !== FIRST_PARTY_PLUGIN_METADATA.length) {
    throw new PenglaiError("SECURITY_POLICY", "plugin catalog set mismatch");
  }
  const seen = new Set<string>();
  const entries = raw.entries.map((value) => {
    if (!isRecord(value) || typeof value.id !== "string") {
      throw new PenglaiError("STORE_CORRUPT", "plugin catalog entry malformed");
    }
    if (seen.has(value.id)) {
      throw new PenglaiError("SECURITY_POLICY", `duplicate catalog ${value.id}`);
    }
    seen.add(value.id);
    const metadata = FIRST_PARTY_PLUGIN_METADATA.find(
      (candidate) => candidate.id === value.id,
    );
    if (!metadata) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        `unlisted package ${value.id}`,
      );
    }
    assertMetadataMatch(value, metadata);
    if (value.target !== expectedTarget) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        `${metadata.id} package target mismatch`,
      );
    }
    if (
      typeof value.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.sha256)
    ) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        `${metadata.id} checksum required`,
      );
    }
    if (typeof value.hasClient !== "boolean") {
      throw new PenglaiError(
        "STORE_CORRUPT",
        `${metadata.id} hasClient missing`,
      );
    }
    return value as unknown as PluginCatalogEntry;
  });
  for (const metadata of FIRST_PARTY_PLUGIN_METADATA) {
    if (!seen.has(metadata.id)) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        `catalog missing ${metadata.id}`,
      );
    }
  }
  return {
    schema: PLUGIN_CATALOG_SCHEMA,
    target: expectedTarget,
    entries,
  };
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function assertPluginPackageManifest(
  raw: unknown,
  entry: PluginCatalogEntry,
): asserts raw is {
  name: string;
  version: string;
  main: string;
  penglaiPlugin: EmbeddedPluginManifest;
} {
  if (!isRecord(raw)) {
    throw new PenglaiError("STORE_CORRUPT", `${entry.id} package manifest malformed`);
  }
  if (raw.name !== entry.id || raw.version !== entry.version) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      `${entry.id} package identity/version mismatch`,
    );
  }
  if (raw.main !== "dist/index.js") {
    throw new PenglaiError("SECURITY_POLICY", `${entry.id} host entry mismatch`);
  }
  const embedded = isRecord(raw.penglaiPlugin) ? raw.penglaiPlugin : undefined;
  if (!embedded || embedded.schema !== 1) {
    throw new PenglaiError("SECURITY_POLICY", `${entry.id} embedded manifest missing`);
  }
  const expected: Record<string, unknown> = {
    id: entry.id,
    dshExact: entry.dsh.exact,
    target: entry.target,
    source: entry.source,
    provenanceClass: entry.provenanceClass,
    license: entry.license,
    migration: entry.migration,
    rollback: entry.rollback,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (embedded[key] !== value) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        `${entry.id} embedded ${key} mismatch`,
      );
    }
  }
  for (const key of ["platforms", "capabilities", "permissions"] as const) {
    if (!sameStringArray(embedded[key], entry[key])) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        `${entry.id} embedded ${key} mismatch`,
      );
    }
  }
  const exports = isRecord(raw.exports) ? raw.exports : undefined;
  if (exports?.["."] !== "./dist/index.js") {
    throw new PenglaiError("SECURITY_POLICY", `${entry.id} export entry mismatch`);
  }
  if (entry.hasClient && exports?.["./client"] !== "./dist/client.js") {
    throw new PenglaiError("SECURITY_POLICY", `${entry.id} client entry missing`);
  }
}

export function loadPluginCatalog(
  pluginsDir: string,
  expectedTarget = runtimePluginTarget(),
  verifyPackages = true,
): PluginCatalogDocument {
  const catalogPath = join(pluginsDir, "catalog.json");
  if (!existsSync(catalogPath)) {
    throw new PenglaiError("STORE_CORRUPT", "plugin catalog missing");
  }
  const document = validatePluginCatalog(
    JSON.parse(readFileSync(catalogPath, "utf8")) as unknown,
    expectedTarget,
  );
  const expectedArchives = new Set(
    document.entries.map((entry) => entry.packageFile),
  );
  const unexpected = readdirSync(pluginsDir).filter(
    (name) => name.endsWith(".tgz") && !expectedArchives.has(name),
  );
  if (unexpected.length) {
    throw new PenglaiError(
      "SECURITY_POLICY",
      `unlisted bundled plugin archive ${unexpected.sort().join(",")}`,
    );
  }
  if (verifyPackages) {
    for (const entry of document.entries) {
      if (basename(entry.packageFile) !== entry.packageFile) {
        throw new PenglaiError(
          "SECURITY_POLICY",
          `${entry.id} unsafe package filename`,
        );
      }
      const packagePath = join(pluginsDir, entry.packageFile);
      if (!existsSync(packagePath)) {
        throw new PenglaiError("STORE_CORRUPT", `${entry.id} package missing`);
      }
      if (sha256File(packagePath) !== entry.sha256) {
        throw new PenglaiError(
          "SECURITY_POLICY",
          `${entry.id} checksum mismatch`,
        );
      }
    }
  }
  return document;
}
