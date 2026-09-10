import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { PenglaiError, RELEASE } from "@penglai/contracts";
import {
  contentAddressedPath,
  PluginDistributionClient,
  pluginDistributionStatePaths,
  selectCatalogArtifact,
  type SignedPluginCatalog,
} from "@penglai/plugin-registry";
import { PINNED_PLUGIN_DSH, type PluginCatalogEntry, type ProductPluginTarget } from "./plugin-catalog.js";
import { inspectTarGz } from "./safe-tar.js";

export function comparePluginVersion(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10));
  const right = b.split(".").map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = Number.isFinite(left[i]) ? left[i]! : 0;
    const r = Number.isFinite(right[i]) ? right[i]! : 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

export interface RemotePluginIdentity {
  id: string;
  version: string;
  sha256: string;
  dshExact: string;
}

export function resolvePluginCatalogEntry(input: {
  bundled?: PluginCatalogEntry;
  remote?: RemotePluginIdentity;
}): { source: "remote" | "bundled"; version: string; sha256?: string; id: string } {
  const bundled = input.bundled;
  const remote = input.remote;
  if (remote) {
    if (!/^[0-9a-f]{64}$/.test(remote.sha256)) {
      throw new PenglaiError("SECURITY_POLICY", "remote plugin digest required");
    }
    if (remote.dshExact !== PINNED_PLUGIN_DSH) {
      if (!bundled) throw new PenglaiError("SECURITY_POLICY", `${remote.id} DSH pin is not ${PINNED_PLUGIN_DSH}`);
    } else if (!bundled || comparePluginVersion(remote.version, bundled.version) > 0) {
      return { source: "remote", version: remote.version, sha256: remote.sha256, id: remote.id };
    }
  }
  if (!bundled) throw new PenglaiError("INVALID_INPUT", "unlisted package");
  return { source: "bundled", version: bundled.version, sha256: bundled.sha256, id: bundled.id };
}

export function shouldPreserveInstalledPlugin(input: {
  installedVersion?: string;
  installedSha256?: string;
  bundledVersion: string;
  bundledSha256?: string;
  catalogSha256?: string;
  catalogDshExact?: string;
  pinnedDsh?: string;
}): boolean {
  if (!input.installedVersion) return false;
  if (comparePluginVersion(input.installedVersion, input.bundledVersion) <= 0) return false;
  if (!/^[0-9a-f]{64}$/.test(input.installedSha256 ?? "")) return false;
  if (!input.catalogSha256 || input.catalogSha256 !== input.installedSha256) return false;
  if (!input.catalogDshExact || !input.pinnedDsh || input.catalogDshExact !== input.pinnedDsh) return false;
  return true;
}

export function overlayIdentityPath(dest: string): string {
  return join(dest, ".penglai-overlay.json");
}

export function readInstalledOverlay(dest: string): { version: string; sha256: string; dshExact?: string } | undefined {
  const path = overlayIdentityPath(dest);
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown; sha256?: unknown; dshExact?: unknown };
    if (typeof raw.version !== "string" || !/^[0-9a-f]{64}$/.test(String(raw.sha256))) return undefined;
    return {
      version: raw.version,
      sha256: String(raw.sha256),
      ...(typeof raw.dshExact === "string" ? { dshExact: raw.dshExact } : {}),
    };
  } catch {
    return undefined;
  }
}

export function writeInstalledOverlay(dest: string, identity: { version: string; sha256: string; dshExact?: string }): void {
  if (!/^[0-9a-f]{64}$/.test(identity.sha256)) throw new PenglaiError("SECURITY_POLICY", "overlay digest required");
  writeFileSync(overlayIdentityPath(dest), `${JSON.stringify({ schema: 1, ...identity })}\n`, { mode: 0o600 });
}

export function assertActivationDigest(actual: string, expected: string): void {
  if (!/^[0-9a-f]{64}$/.test(actual) || actual !== expected) {
    throw new PenglaiError("SECURITY_POLICY", "plugin activation digest mismatch");
  }
}

export function signedArtifactIdentity(
  catalog: SignedPluginCatalog,
  id: string,
  target: ProductPluginTarget,
): { version: string; sha256: string; dshExact: string } | undefined {
  const entry = catalog.entries.find((row) => row.id === id);
  if (!entry) return undefined;
  try {
    const artifact = selectCatalogArtifact(entry.artifacts, target);
    if (!/^[0-9a-f]{64}$/.test(artifact.sha256)) return undefined;
    return { version: entry.version, sha256: artifact.sha256, dshExact: entry.dsh.exact };
  } catch {
    return undefined;
  }
}

export function loadVerifiedSignedPluginCatalog(userDataRoot: string | undefined): SignedPluginCatalog | undefined {
  if (!userDataRoot) return undefined;
  try {
    const client = new PluginDistributionClient({
      ...pluginDistributionStatePaths(userDataRoot),
      penglaiVersion: RELEASE,
      dshExact: PINNED_PLUGIN_DSH,
    });
    return client.snapshot()?.catalog;
  } catch {
    return undefined;
  }
}

export function installedPluginManifest(
  dest: string,
): { id: string; version: string; dshExact?: string } | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf8")) as {
      name?: unknown;
      version?: unknown;
      penglaiPlugin?: { dshExact?: unknown };
    };
    if (typeof pkg.name !== "string" || typeof pkg.version !== "string") return undefined;
    const dshExact =
      pkg.penglaiPlugin && typeof pkg.penglaiPlugin.dshExact === "string" ? pkg.penglaiPlugin.dshExact : undefined;
    return { id: pkg.name, version: pkg.version, ...(dshExact ? { dshExact } : {}) };
  } catch {
    return undefined;
  }
}

export function firstPartyRetentionDecision(input: {
  pluginId: string;
  bundledVersion: string;
  bundledSha256?: string;
  installed: { id: string; version: string; overlaySha256?: string; dshExact?: string };
  signed?: { version: string; sha256: string; dshExact: string };
}): boolean {
  if (input.installed.id !== input.pluginId) return false;
  if (!input.signed) return false;
  if (input.installed.version !== input.signed.version) return false;
  if (input.installed.dshExact && input.installed.dshExact !== input.signed.dshExact) return false;
  return shouldPreserveInstalledPlugin({
    installedVersion: input.installed.version,
    bundledVersion: input.bundledVersion,
    catalogSha256: input.signed.sha256,
    catalogDshExact: input.signed.dshExact,
    pinnedDsh: PINNED_PLUGIN_DSH,
    ...(input.installed.overlaySha256 ? { installedSha256: input.installed.overlaySha256 } : {}),
    ...(input.bundledSha256 ? { bundledSha256: input.bundledSha256 } : {}),
  });
}

function readOpenedRegularFile(path: string): Buffer {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    const named = lstatSync(path);
    if (
      !opened.isFile() ||
      named.isSymbolicLink() ||
      !named.isFile() ||
      opened.dev !== named.dev ||
      opened.ino !== named.ino
    ) {
      throw new PenglaiError("SECURITY_POLICY", "regular file identity changed");
    }
    return readFileSync(fd);
  } catch (error) {
    if (error instanceof PenglaiError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP") {
      throw new PenglaiError("SECURITY_POLICY", "file is a symlink source");
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readRegularArtifactBytes(path: string): Buffer | undefined {
  try {
    return readOpenedRegularFile(path);
  } catch {
    return undefined;
  }
}

export function verifiedPluginArtifactPath(userDataRoot: string | undefined, sha256: string): string | undefined {
  if (!userDataRoot || !/^[0-9a-f]{64}$/.test(sha256)) return undefined;
  try {
    return contentAddressedPath(pluginDistributionStatePaths(userDataRoot).cacheRoot, sha256, ".tgz");
  } catch {
    return undefined;
  }
}

function normalizeArchiveFilePath(path: string, stripPackagePrefix: boolean): string {
  let next = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (stripPackagePrefix && next.startsWith("package/")) next = next.slice("package/".length);
  return next;
}

function walkInstalledPluginTree(dest: string): { files: Map<string, Buffer>; dirs: Set<string> } {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  const visit = (rel: string): void => {
    const directory = rel ? join(dest, rel) : dest;
    for (const name of readdirSync(directory)) {
      if (!rel && name === ".penglai-overlay.json") continue;
      const childRel = rel ? `${rel}/${name}` : name;
      const full = join(dest, childRel);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        throw new PenglaiError("SECURITY_POLICY", "installed plugin contains symlink");
      }
      if (st.isDirectory()) {
        dirs.add(childRel.replace(/\\/g, "/"));
        visit(childRel);
        continue;
      }
      if (!st.isFile()) {
        throw new PenglaiError("SECURITY_POLICY", "installed plugin has unexpected node type");
      }
      try {
        files.set(childRel.replace(/\\/g, "/"), readOpenedRegularFile(full));
      } catch (error) {
        if (error instanceof PenglaiError && /symlink/i.test(error.message)) {
          throw new PenglaiError("SECURITY_POLICY", "installed plugin contains symlink");
        }
        throw new PenglaiError("SECURITY_POLICY", "installed plugin file identity changed");
      }
    }
  };
  visit("");
  return { files, dirs };
}

function assertInstalledManifestClosure(
  dest: string,
  pluginId: string,
  signed: { version: string; sha256: string; dshExact: string },
  hostTarget: ProductPluginTarget,
): void {
  const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf8")) as {
    name?: unknown;
    version?: unknown;
    main?: unknown;
    exports?: { "."?: unknown };
    penglaiPlugin?: {
      id?: unknown;
      dshExact?: unknown;
      target?: unknown;
    };
  };
  if (pkg.name !== pluginId || pkg.version !== signed.version) {
    throw new PenglaiError("SECURITY_POLICY", "installed plugin identity drift");
  }
  const embedded = pkg.penglaiPlugin;
  if (!embedded || embedded.dshExact !== signed.dshExact || signed.dshExact !== PINNED_PLUGIN_DSH) {
    throw new PenglaiError("SECURITY_POLICY", "installed plugin DSH pin mismatch");
  }
  if (typeof embedded.id === "string" && embedded.id !== pluginId) {
    throw new PenglaiError("SECURITY_POLICY", "installed plugin id mismatch");
  }
  if (typeof embedded.target === "string" && embedded.target !== hostTarget) {
    throw new PenglaiError("SECURITY_POLICY", "installed plugin target mismatch");
  }
  const main = typeof pkg.main === "string" ? pkg.main : "";
  const exp = pkg.exports?.["."];
  const exported = typeof exp === "string" ? exp : "";
  if (main.includes("src/") || exported.includes("src/") || main.endsWith(".ts") || exported.endsWith(".ts")) {
    throw new PenglaiError("SECURITY_POLICY", "installed plugin entry still points at src");
  }
}

/** Overlay/catalog digest strings are claims. Retention requires the CAS artifact and installed tree. */
export function installedPluginMatchesVerifiedArtifact(input: {
  dest: string;
  pluginId: string;
  signed: { version: string; sha256: string; dshExact: string };
  userDataRoot?: string;
  hostTarget: ProductPluginTarget;
}): boolean {
  try {
    const artifactPath = verifiedPluginArtifactPath(input.userDataRoot, input.signed.sha256);
    if (!artifactPath) return false;
    const bytes = readRegularArtifactBytes(artifactPath);
    if (!bytes) return false;
    if (createHash("sha256").update(bytes).digest("hex") !== input.signed.sha256) return false;
    const entries = inspectTarGz(bytes);
    const names = entries
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.path.replace(/\\/g, "/").replace(/^\.\//, ""));
    const stripPackagePrefix = names.includes("package/package.json") && !names.includes("package.json");
    const expectedFiles = new Map<string, Buffer>();
    const expectedDirs = new Set<string>();
    for (const entry of entries) {
      const path = normalizeArchiveFilePath(entry.path, stripPackagePrefix);
      if (!path || path === ".penglai-overlay.json") continue;
      if (entry.kind === "directory") {
        expectedDirs.add(path);
        continue;
      }
      if (entry.kind !== "file") {
        throw new PenglaiError("SECURITY_POLICY", "archive has unexpected entry kind");
      }
      expectedFiles.set(path, entry.data);
      const parts = path.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i += 1) expectedDirs.add(parts.slice(0, i).join("/"));
    }
    if (!expectedFiles.has("package.json") || !expectedFiles.has("dist/index.js")) {
      throw new PenglaiError("SECURITY_POLICY", "verified plugin archive missing host files");
    }
    assertInstalledManifestClosure(input.dest, input.pluginId, input.signed, input.hostTarget);
    const installed = walkInstalledPluginTree(input.dest);
    if (installed.files.size !== expectedFiles.size) return false;
    for (const [path, data] of expectedFiles) {
      const actual = installed.files.get(path);
      if (!actual || !actual.equals(data)) return false;
    }
    for (const dir of installed.dirs) {
      if (!expectedDirs.has(dir)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isolateUntrustedPluginInstall(dest: string, txDir: string, pluginId: string): string {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const short = pluginId.replace(/^@/, "").replaceAll("/", "-");
  const quarantine = join(txDir, `uncertain-plugin-${short}-${stamp}`);
  mkdirSync(txDir, { recursive: true, mode: 0o700 });
  renameSync(dest, quarantine);
  return quarantine;
}
