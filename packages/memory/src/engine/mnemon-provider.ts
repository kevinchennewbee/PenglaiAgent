import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import { MNEMON_ASSETS, mnemonAssetForHost } from "@penglai/release-identity";
import type { MnemonAssetPin } from "@penglai/release-identity";

export { MNEMON_ASSETS };

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function bundledMnemonRoot(appRoot?: string): string | undefined {
  const root = appRoot || process.env.PENGLAI_APP_ROOT;
  if (!root || !isAbsolute(root) || root.includes("\0")) return undefined;
  return join(root, "mnemon");
}

export function hostMnemonTarget(
  platform = process.platform,
  arch: string = process.arch,
): MnemonAssetPin | undefined {
  return mnemonAssetForHost(platform, arch);
}

export function resolveMnemonBinary(opts: {
  explicitPath?: string;
  appRoot?: string;
  verifyHash?: boolean;
  platform?: NodeJS.Platform;
  arch?: string;
} = {}): { path: string; sha256: string; target: string } | undefined {
  const asset = hostMnemonTarget(opts.platform ?? process.platform, opts.arch ?? process.arch);
  if (!asset) return undefined;
  const candidates: string[] = [];
  if (opts.explicitPath) candidates.push(opts.explicitPath);
  if (process.env.PENGLAI_MNEMON_BINARY) candidates.push(process.env.PENGLAI_MNEMON_BINARY);
  const resourceRoot = bundledMnemonRoot(opts.appRoot);
  if (resourceRoot) candidates.push(join(resourceRoot, asset.binaryFilename));
  for (const raw of candidates) {
    if (!raw || !isAbsolute(raw) || raw.includes("..") || raw.includes("\0")) continue;
    if (!existsSync(raw)) continue;
    const st = statSync(raw);
    if (!st.isFile()) continue;
    const path = realpathSync(raw);
    const sha256 = sha256File(path);
    if (opts.verifyHash !== false && sha256 !== asset.binarySha256) {
      throw new PenglaiError("STORE_CORRUPT", "mnemon binary hash mismatch");
    }
    if (asset.executable && process.platform !== "win32" && (st.mode & 0o111) === 0) {
      throw new PenglaiError("STORE_CORRUPT", "mnemon binary is not executable");
    }
    return { path, sha256, target: asset.target };
  }
  return undefined;
}

/** @deprecated use resolveMnemonBinary; production never falls back to cwd. */
export function bundledMnemonBinary(
  platform = process.platform,
  arch = process.arch,
  root?: string,
): { path: string; sha256: string; target: string } | undefined {
  return resolveMnemonBinary({
    ...(root ? { appRoot: root } : {}),
    platform,
    arch,
    verifyHash: false,
  });
}

export function verifyMnemonAsset(archivePath: string, expectedSha256: string): void {
  const actual = sha256File(archivePath);
  if (actual !== expectedSha256) {
    throw new Error(`mnemon asset checksum mismatch ${actual}`);
  }
}
