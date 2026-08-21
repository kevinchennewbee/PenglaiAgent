import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PenglaiError } from "@penglai/contracts";

export const PLUGIN_OWNER_ACTIONS = ["plugin-enable", "plugin-update", "plugin-install"] as const;
export type PluginOwnerAction = (typeof PLUGIN_OWNER_ACTIONS)[number];

export interface PluginOwnerGrant {
  capabilityId: string;
  action: PluginOwnerAction;
  pluginId: string;
  version: string;
  sha256: string;
  permissionDigest: string;
  nonce: string;
  expiresAt: number;
}

export function pluginPermissionDigest(input: {
  permissions: readonly string[];
  networkOrigins?: readonly string[];
  dataPaths?: readonly string[];
  nativeCode?: boolean;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        permissions: [...input.permissions],
        networkOrigins: [...(input.networkOrigins ?? [])],
        dataPaths: [...(input.dataPaths ?? [])],
        nativeCode: input.nativeCode === true,
      }),
    )
    .digest("hex");
}

export function pluginOwnerPath(userDataRoot: string): string {
  return join(userDataRoot, "plugins", "owner-capability.json");
}

export function issuePluginOwnerGrant(input: {
  userDataRoot: string;
  action: PluginOwnerAction;
  pluginId: string;
  version: string;
  sha256: string;
  permissionDigest: string;
  now?: number;
  ttlMs?: number;
}): PluginOwnerGrant {
  const now = input.now ?? Date.now();
  const grant: PluginOwnerGrant = {
    capabilityId: `owncap_${randomBytes(16).toString("hex")}`,
    action: input.action,
    pluginId: input.pluginId,
    version: input.version,
    sha256: input.sha256,
    permissionDigest: input.permissionDigest,
    nonce: randomBytes(16).toString("hex"),
    expiresAt: now + (input.ttlMs ?? 120_000),
  };
  const path = pluginOwnerPath(input.userDataRoot);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(grant)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  return grant;
}

export function consumePluginOwnerGrant(input: {
  userDataRoot: string;
  capabilityId: string;
  action: PluginOwnerAction;
  pluginId: string;
  version: string;
  sha256: string;
  permissionDigest: string;
  now?: number;
}): void {
  const path = pluginOwnerPath(input.userDataRoot);
  if (!existsSync(path)) {
    throw new PenglaiError("SECURITY_POLICY", "native owner capability is required");
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as PluginOwnerGrant;
  rmSync(path, { force: true });
  const now = input.now ?? Date.now();
  if (
    raw.capabilityId !== input.capabilityId ||
    raw.action !== input.action ||
    raw.pluginId !== input.pluginId ||
    raw.version !== input.version ||
    raw.sha256 !== input.sha256 ||
    raw.permissionDigest !== input.permissionDigest ||
    raw.expiresAt <= now ||
    !/^owncap_[a-f0-9]{32}$/.test(raw.capabilityId)
  ) {
    throw new PenglaiError("SECURITY_POLICY", "owner capability is invalid, expired, or already used");
  }
}
