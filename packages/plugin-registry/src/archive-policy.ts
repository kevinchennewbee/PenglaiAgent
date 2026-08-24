import { PenglaiError } from "@penglai/contracts";

const NATIVE_SUFFIX = [".node", ".dylib", ".dll", ".exe", ".bin", ".so"];
const BYTECODE_SUFFIX = [".wasm", ".wat", ".bc", ".class"];
const ARCHIVE_SUFFIX = [".jar", ".zip", ".7z", ".rar", ".tgz", ".tar", ".tar.gz", ".tar.bz2", ".tar.xz"];
const FORBIDDEN_NAMES = new Set(["preinstall", "postinstall", "prepare", "install"]);

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const PE_MAGIC = Buffer.from([0x4d, 0x5a]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const LLVM_BC = Buffer.from([0x42, 0x43, 0xc0, 0xde]);
const MACHO_MAGICS = [
  Buffer.from([0xfe, 0xed, 0xfa, 0xce]),
  Buffer.from([0xce, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
];

function hasPrefix(data: Buffer, magic: Buffer): boolean {
  return data.length >= magic.length && data.subarray(0, magic.length).equals(magic);
}

function suffixMatch(lower: string, suffix: string): boolean {
  if (lower.endsWith(suffix)) return true;
  return lower.includes(`${suffix}.`);
}

function soVersioned(lower: string): boolean {
  return /\.so(?:\.\d+)+$/.test(lower) || lower.includes(".so.");
}

export function forbiddenRemotePluginKind(path: string): "native" | "bytecode" | "archive" | undefined {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  if (NATIVE_SUFFIX.some((suffix) => suffixMatch(lower, suffix)) || soVersioned(lower)) return "native";
  if (BYTECODE_SUFFIX.some((suffix) => suffixMatch(lower, suffix))) return "bytecode";
  if (ARCHIVE_SUFFIX.some((suffix) => suffixMatch(lower, suffix))) return "archive";
  return undefined;
}

export function remotePluginMagicKind(data: Buffer): "native" | "bytecode" | "archive" | undefined {
  if (hasPrefix(data, ELF_MAGIC) || hasPrefix(data, PE_MAGIC) || MACHO_MAGICS.some((magic) => hasPrefix(data, magic))) {
    return "native";
  }
  if (hasPrefix(data, WASM_MAGIC) || hasPrefix(data, LLVM_BC)) return "bytecode";
  if (hasPrefix(data, ZIP_MAGIC) || hasPrefix(data, GZIP_MAGIC)) return "archive";
  return undefined;
}

function rejectKind(kind: "native" | "bytecode" | "archive", cause: "name" | "magic"): never {
  if (kind === "native") throw new PenglaiError("SECURITY_POLICY", "native code is not a remote plugin");
  if (kind === "bytecode") throw new PenglaiError("SECURITY_POLICY", "bytecode is not a remote plugin");
  throw new PenglaiError(
    "SECURITY_POLICY",
    cause === "magic" ? "plugin payload magic mismatch" : "nested archive is not a remote plugin",
  );
}

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
  for (const entry of entries) {
    const name = entry.path.replace(/\\/g, "/");
    if (!name || name.includes("..") || name.startsWith("/") || name.includes("\0")) {
      throw new PenglaiError("SECURITY_POLICY", "archive path escape");
    }
    const lower = name.toLowerCase();
    if (folded.has(lower)) throw new PenglaiError("SECURITY_POLICY", "archive case collision");
    folded.add(lower);
    const named = forbiddenRemotePluginKind(name);
    if (named) rejectKind(named, "name");
    if (entry.kind === "file") {
      const magic = remotePluginMagicKind(entry.data);
      if (magic) rejectKind(magic, "magic");
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
  if (typeof o.entry !== "string" || !o.entry.trim() || o.entry.includes("..") || o.entry.startsWith("/")) {
    throw new PenglaiError("INVALID_INPUT", "plugin entry");
  }
  if (!Array.isArray(o.targets) || o.targets.length < 1 || o.targets.some((item) => typeof item !== "string" || !item)) {
    throw new PenglaiError("INVALID_INPUT", "plugin targets");
  }
  if (!Array.isArray(o.capabilities) || o.capabilities.some((item) => typeof item !== "string")) {
    throw new PenglaiError("INVALID_INPUT", "plugin capabilities");
  }
  if (!Array.isArray(o.permissions) || o.permissions.some((item) => typeof item !== "string")) {
    throw new PenglaiError("INVALID_INPUT", "plugin permissions");
  }
  if (!Array.isArray(o.networkOrigins) || o.networkOrigins.some((item) => typeof item !== "string")) {
    throw new PenglaiError("INVALID_INPUT", "plugin networkOrigins");
  }
  if (!Array.isArray(o.dataPaths) || o.dataPaths.some((item) => typeof item !== "string")) {
    throw new PenglaiError("INVALID_INPUT", "plugin dataPaths");
  }
  if (typeof o.license !== "string" || !o.license.trim()) {
    throw new PenglaiError("INVALID_INPUT", "plugin license");
  }
  if (typeof o.clientEntry === "string" && (o.clientEntry.includes("..") || o.clientEntry.startsWith("/"))) {
    throw new PenglaiError("SECURITY_POLICY", "plugin clientEntry path escape");
  }
  return {
    schema: 2,
    id: o.id,
    version: o.version,
    dshExact: o.dshExact,
    centerProtocol: 1,
    entry: o.entry,
    ...(typeof o.clientEntry === "string" && o.clientEntry ? { clientEntry: o.clientEntry } : {}),
    targets: o.targets.map(String),
    capabilities: o.capabilities.map(String),
    permissions: o.permissions.map(String),
    nativeCode: false,
    installScripts: false,
    networkOrigins: o.networkOrigins.map(String),
    dataPaths: o.dataPaths.map(String),
    license: o.license,
  };
}

export function assertManifestMatchesCatalog(input: {
  catalogId: string;
  catalogVersion: string;
  catalogPermissions: readonly string[];
  catalogCapabilities: readonly string[];
  catalogDsh: string;
  manifest: EmbeddedPluginManifestV2;
  catalogEntry?: string;
  catalogClientEntry?: string;
  catalogTargets?: readonly string[];
  catalogNativeCode?: false;
  catalogNetworkOrigins?: readonly string[];
  catalogDataPaths?: readonly string[];
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
  if (input.catalogEntry && input.manifest.entry !== input.catalogEntry) {
    throw new PenglaiError("SECURITY_POLICY", "embedded manifest entry drift");
  }
  if (input.catalogClientEntry !== undefined && input.manifest.clientEntry !== input.catalogClientEntry) {
    throw new PenglaiError("SECURITY_POLICY", "embedded manifest clientEntry drift");
  }
  if (input.catalogTargets && input.manifest.targets.join("\0") !== input.catalogTargets.join("\0")) {
    throw new PenglaiError("SECURITY_POLICY", "embedded manifest targets drift");
  }
  if (input.catalogNativeCode !== undefined && input.manifest.nativeCode !== input.catalogNativeCode) {
    throw new PenglaiError("SECURITY_POLICY", "embedded manifest nativeCode drift");
  }
  if (input.catalogNetworkOrigins && input.manifest.networkOrigins.join("\0") !== input.catalogNetworkOrigins.join("\0")) {
    throw new PenglaiError("SECURITY_POLICY", "embedded manifest networkOrigins drift");
  }
  if (input.catalogDataPaths && input.manifest.dataPaths.join("\0") !== input.catalogDataPaths.join("\0")) {
    throw new PenglaiError("SECURITY_POLICY", "embedded manifest dataPaths drift");
  }
}
