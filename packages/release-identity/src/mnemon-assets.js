/** Single authority for packaged Mnemon 0.2.8. Archive hash ≠ binary hash. */

export const MNEMON_UPSTREAM = Object.freeze({
  owner: "mnemon-dev",
  repo: "mnemon",
  tag: "v0.2.8",
  version: "0.2.8",
  license: "Apache-2.0",
  licenseSha256: "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
  commit: "da9b7da0e3e7f10c84d5f8e9a42e24453c8159bb",
  hostAllowlist: ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"],
});

export const MNEMON_ASSETS = Object.freeze([
  {
    target: "darwin-aarch64",
    platform: "darwin",
    arch: "arm64",
    pluginTarget: "darwin-arm64",
    archiveFilename: "mnemon_0.2.8_darwin_arm64.tar.gz",
    archiveSha256: "96159ad2fe8f0531b5a00ab009849614c234032146b95fa2db5aa726a8922e2d",
    archiveBytes: 6_288_629,
    binaryFilename: "mnemon",
    binarySha256: "f8f21151ce9777983b8d2dfb9cbea1a00b223de6063659af232d04aa57cedad0",
    binaryBytes: 15_469_442,
    executable: true,
  },
  {
    target: "darwin-x86_64",
    platform: "darwin",
    arch: "x64",
    pluginTarget: "darwin-x64",
    archiveFilename: "mnemon_0.2.8_darwin_amd64.tar.gz",
    archiveSha256: "bede7424e076850327485bcbe5a04667abb0f2190c35d6bb4f281e1b86117a36",
    archiveBytes: 6_661_975,
    binaryFilename: "mnemon",
    binarySha256: "727b7835d728a6c76b748eacafa73ca752fb91f20cd33ecdf05ac2616481f606",
    binaryBytes: 16_271_744,
    executable: true,
  },
  {
    target: "win32-x86_64",
    platform: "win32",
    arch: "x64",
    pluginTarget: "win32-x64",
    archiveFilename: "mnemon_0.2.8_windows_amd64.zip",
    archiveSha256: "a61be46f98a243cf6b1194241ef808a880ba57a1c5c2cb0f7152502db80655f3",
    archiveBytes: 5_708_647,
    binaryFilename: "mnemon.exe",
    binarySha256: "d55e69934b68d3d456a3750d04e394e6828290cf8e00e5b927c39fe39daedbe3",
    binaryBytes: 13_734_400,
    executable: true,
  },
  {
    target: "linux-loong64",
    platform: "linux",
    arch: "loong64",
    pluginTarget: "linux-loong64",
    archiveFilename: "mnemon_0.2.8_linux_loong64.tar.gz",
    archiveSha256: "29474c67d5ed878e055e45103aed188b325e72dece03e92813eb1776dff66fc7",
    archiveBytes: 6_100_624,
    binaryFilename: "mnemon",
    binarySha256: "a8bc5fc48cbbc60f572dcbb02bf065165837d2134174804820782d2db88bb5be",
    binaryBytes: 15_401_144,
    executable: true,
    architectureBuild: true,
    sourceCommit: "da9b7da0e3e7f10c84d5f8e9a42e24453c8159bb",
  },
]);

export function mnemonReleaseUrl(filename) {
  return `https://github.com/${MNEMON_UPSTREAM.owner}/${MNEMON_UPSTREAM.repo}/releases/download/${MNEMON_UPSTREAM.tag}/${filename}`;
}

export function mnemonAssetForTarget(target) {
  return MNEMON_ASSETS.find((row) => row.target === target);
}

export function mnemonAssetForHost(platform = process.platform, arch = process.arch) {
  const normalized =
    arch === "arm64" || arch === "x64"
      ? arch
      : arch === "loong64" || arch === "loongarch64"
        ? "loong64"
        : "other";
  return MNEMON_ASSETS.find((row) => row.platform === platform && row.arch === normalized);
}

export function mnemonAssetForPluginTarget(pluginTarget) {
  return MNEMON_ASSETS.find((row) => row.pluginTarget === pluginTarget);
}
