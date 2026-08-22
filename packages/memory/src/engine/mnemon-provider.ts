import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const MNEMON_ASSETS = [
  {
    target: "darwin-aarch64",
    platform: "darwin",
    arch: "arm64",
    filename: "mnemon_0.2.4_darwin_arm64.tar.gz",
    sha256: "d363b6f3826acc50b9e21aa298c8d36010c53c480000878a13b6d41d5d5dcbd6",
    binary: "mnemon",
  },
  {
    target: "darwin-x86_64",
    platform: "darwin",
    arch: "x64",
    filename: "mnemon_0.2.4_darwin_amd64.tar.gz",
    sha256: "fd4cae937a28851848ea8d6916e2137cc0a0441a97873f691fa1a07ce76b51a7",
    binary: "mnemon",
  },
  {
    target: "win32-x86_64",
    platform: "win32",
    arch: "x64",
    filename: "mnemon_0.2.4_windows_amd64.zip",
    sha256: "5194137995f2193de73a5b3fb22f39fb773f1c0f8db5f6f96eaced5f94422b8c",
    binary: "mnemon.exe",
  },
] as const;

export function bundledMnemonRoot(appRoot = process.env.PENGLAI_APP_ROOT): string {
  return join(appRoot || process.cwd(), "third_party", "mnemon");
}

export function hostMnemonTarget(
  platform = process.platform,
  arch = process.arch,
): (typeof MNEMON_ASSETS)[number] | undefined {
  const normalized = arch === "arm64" || arch === "x64" ? arch : "other";
  return MNEMON_ASSETS.find((row) => row.platform === platform && row.arch === normalized);
}

export function bundledMnemonBinary(
  platform = process.platform,
  arch = process.arch,
  root = bundledMnemonRoot(),
): { path: string; sha256: string; target: string } | undefined {
  const asset = hostMnemonTarget(platform, arch);
  if (!asset) return undefined;
  const path = join(root, "bin", asset.target, asset.binary);
  if (!existsSync(path)) return undefined;
  return { path, sha256: asset.sha256, target: asset.target };
}

export function verifyMnemonAsset(archivePath: string, expectedSha256: string): void {
  const actual = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(`mnemon asset checksum mismatch ${actual}`);
  }
}
