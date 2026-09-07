import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { PINNED_PLUGIN_DSH, type PluginCatalogEntry } from "./plugin-catalog.js";

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
}): boolean {
  if (!input.installedVersion) return false;
  return comparePluginVersion(input.installedVersion, input.bundledVersion) > 0;
}

export function overlayIdentityPath(dest: string): string {
  return join(dest, ".penglai-overlay.json");
}

export function readInstalledOverlay(dest: string): { version: string; sha256: string } | undefined {
  const path = overlayIdentityPath(dest);
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown; sha256?: unknown };
    if (typeof raw.version !== "string" || !/^[0-9a-f]{64}$/.test(String(raw.sha256))) return undefined;
    return { version: raw.version, sha256: String(raw.sha256) };
  } catch {
    return undefined;
  }
}

export function writeInstalledOverlay(dest: string, identity: { version: string; sha256: string }): void {
  if (!/^[0-9a-f]{64}$/.test(identity.sha256)) throw new PenglaiError("SECURITY_POLICY", "overlay digest required");
  writeFileSync(overlayIdentityPath(dest), `${JSON.stringify({ schema: 1, ...identity })}\n`, { mode: 0o600 });
}

export function assertActivationDigest(actual: string, expected: string): void {
  if (!/^[0-9a-f]{64}$/.test(actual) || actual !== expected) {
    throw new PenglaiError("SECURITY_POLICY", "plugin activation digest mismatch");
  }
}
