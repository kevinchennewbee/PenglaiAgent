/** Single authority for packaged Mnemon 0.2.4. Archive hash ≠ binary hash. */

export const MNEMON_UPSTREAM = Object.freeze({
  owner: "mnemon-dev",
  repo: "mnemon",
  tag: "v0.2.4",
  version: "0.2.4",
  license: "MIT",
  commit: "67ed1a2f80de902fd041eeaf3b90e7e3d2480d5b",
  hostAllowlist: ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"],
});

export const MNEMON_ASSETS = Object.freeze([
  {
    target: "darwin-aarch64",
    platform: "darwin",
    arch: "arm64",
    pluginTarget: "darwin-arm64",
    archiveFilename: "mnemon_0.2.4_darwin_arm64.tar.gz",
    archiveSha256: "d363b6f3826acc50b9e21aa298c8d36010c53c480000878a13b6d41d5d5dcbd6",
    archiveBytes: 6_314_858,
    binaryFilename: "mnemon",
    binarySha256: "5dd38a083b9e790f9e6f3b4192aaf6d46c735dc05e8eabef18f05749ec83ca1f",
    binaryBytes: 15_419_520,
    executable: true,
  },
  {
    target: "darwin-x86_64",
    platform: "darwin",
    arch: "x64",
    pluginTarget: "darwin-x64",
    archiveFilename: "mnemon_0.2.4_darwin_amd64.tar.gz",
    archiveSha256: "fd4cae937a28851848ea8d6916e2137cc0a0441a97873f691fa1a07ce76b51a7",
    archiveBytes: 6_665_967,
    binaryFilename: "mnemon",
    binarySha256: "4fbb6f823c7047cf77ed7ed46af5c3b10117cf92f0ea12e6da4ddef375c694d0",
    binaryBytes: 16_201_728,
    executable: true,
  },
  {
    target: "win32-x86_64",
    platform: "win32",
    arch: "x64",
    pluginTarget: "win32-x64",
    archiveFilename: "mnemon_0.2.4_windows_amd64.zip",
    archiveSha256: "5194137995f2193de73a5b3fb22f39fb773f1c0f8db5f6f96eaced5f94422b8c",
    archiveBytes: 5_705_596,
    binaryFilename: "mnemon.exe",
    binarySha256: "a2fc44b07cf51ea32c127858c7aa4d7d5555d7031f2ece07d612ad7670039cbe",
    binaryBytes: 13_667_840,
    executable: true,
  },
]);

export function mnemonReleaseUrl(filename) {
  return `https://github.com/${MNEMON_UPSTREAM.owner}/${MNEMON_UPSTREAM.repo}/releases/download/${MNEMON_UPSTREAM.tag}/${filename}`;
}

export function mnemonAssetForTarget(target) {
  return MNEMON_ASSETS.find((row) => row.target === target);
}

export function mnemonAssetForHost(platform = process.platform, arch = process.arch) {
  const normalized = arch === "arm64" || arch === "x64" ? arch : "other";
  return MNEMON_ASSETS.find((row) => row.platform === platform && row.arch === normalized);
}

export function mnemonAssetForPluginTarget(pluginTarget) {
  return MNEMON_ASSETS.find((row) => row.pluginTarget === pluginTarget);
}
