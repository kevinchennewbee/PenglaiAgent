import { PenglaiError } from "@penglai/contracts";

const FORBIDDEN_SUFFIX = [".node", ".dylib", ".so", ".dll", ".exe", ".bin"];
const FORBIDDEN_NAMES = new Set(["preinstall", "postinstall", "prepare", "install"]);

export interface ArchiveFile {
  path: string;
  kind: "file" | "directory";
  data: Buffer;
}

export interface EmbeddedPluginManifestV2 {
  schema: 2;
  id: string;
  version: string;
  dshExact: string;
  centerProtocol: 1;
  entry: string;
  clientEntry?: string;
  targets: string[];
  capabilities: string[];
  permissions: string[];
  nativeCode: false;
  installScripts: false;
  networkOrigins: string[];
  dataPaths: string[];
  license: string;
}

export function inspectPluginEntries(entries: readonly ArchiveFile[]): {
  files: string[];
  manifest: EmbeddedPluginManifestV2;
} {
  const names = entries.map((entry) => entry.path.replace(/\\/g, "/"));
  const folded = new Set<string>();
  for (const name of names) {
    if (!name || name.includes("..") || name.startsWith("/") || name.includes("\0")) {
      throw new PenglaiError("SECURITY_POLICY", "archive path escape");
    }
    const lower = name.toLowerCase();
    if (folded.has(lower)) throw new PenglaiError("SECURITY_POLICY", "archive case collision");
    folded.add(lower);
    if (FORBIDDEN_SUFFIX.some((suffix) => lower.endsWith(suffix))) {
      throw new PenglaiError("SECURITY_POLICY", "native code is not a remote plugin");
    }
  }
  const pkgEntry = entries.find((entry) => /(^|\/)package\.json$/.test(entry.path) && entry.kind === "file");
  if (!pkgEntry) throw new PenglaiError("INVALID_INPUT", "plugin package.json missing");
  const pkg = JSON.parse(pkgEntry.data.toString("utf8")) as {
    scripts?: Record<string, unknown>;
    penglaiPlugin?: unknown;
  };
  if (pkg.scripts) {
    for (const name of Object.keys(pkg.scripts)) {
      if (FORBIDDEN_NAMES.has(name)) throw new PenglaiError("SECURITY_POLICY", "lifecycle scripts forbidden");
    }
  }
  return { files: names, manifest: parseManifestV2(pkg.penglaiPlugin) };
}

function parseManifestV2(raw: unknown): EmbeddedPluginManifestV2 {
  if (!raw || typeof raw !== "object") throw new PenglaiError("INVALID_INPUT", "penglaiPlugin manifest");
  const o = raw as Record<string, unknown>;
  if (o.schema !== 2) throw new PenglaiError("INVALID_INPUT", "penglaiPlugin schema 2 required");
  if (o.nativeCode !== false) throw new PenglaiError("SECURITY_POLICY", "remote plugin cannot ship nativeCode");
  if (o.installScripts !== false) throw new PenglaiError("SECURITY_POLICY", "installScripts must be false");
  if (o.centerProtocol !== 1) throw new PenglaiError("SECURITY_POLICY", "centerProtocol");
  if (typeof o.id !== "string" || typeof o.version !== "string" || typeof o.dshExact !== "string") {
    throw new PenglaiError("INVALID_INPUT", "plugin identity");
  }
  return {
    schema: 2,
    id: o.id,
    version: o.version,
    dshExact: o.dshExact,
    centerProtocol: 1,
    entry: String(o.entry ?? "dist/index.js"),
    ...(typeof o.clientEntry === "string" ? { clientEntry: o.clientEntry } : {}),
    targets: Array.isArray(o.targets) ? o.targets.map(String) : ["any"],
    capabilities: Array.isArray(o.capabilities) ? o.capabilities.map(String) : [],
    permissions: Array.isArray(o.permissions) ? o.permissions.map(String) : [],
    nativeCode: false,
    installScripts: false,
    networkOrigins: Array.isArray(o.networkOrigins) ? o.networkOrigins.map(String) : [],
    dataPaths: Array.isArray(o.dataPaths) ? o.dataPaths.map(String) : [],
    license: String(o.license ?? "MIT"),
  };
}

export function assertManifestMatchesCatalog(input: {
  catalogId: string;
  catalogVersion: string;
  catalogPermissions: readonly string[];
  catalogCapabilities: readonly string[];
  catalogDsh: string;
  manifest: EmbeddedPluginManifestV2;
}): void {
  if (input.manifest.id !== input.catalogId || input.manifest.version !== input.catalogVersion) {
    throw new PenglaiError("SECURITY_POLICY", "embedded manifest identity drift");
  }
  if (input.manifest.dshExact !== input.catalogDsh) {
    throw new PenglaiError("SECURITY_POLICY", "embedded manifest DSH drift");
  }
  if (input.manifest.permissions.join("\0") !== input.catalogPermissions.join("\0")) {
    throw new PenglaiError("SECURITY_POLICY", "package requested permissions not in signed catalog");
  }
  if (input.manifest.capabilities.join("\0") !== input.catalogCapabilities.join("\0")) {
    throw new PenglaiError("SECURITY_POLICY", "package capabilities drift");
  }
}
