/** Single authority for the spawned Poppler pdftoppm helper. Archive hash ≠ published tree hash. */

export const POPPLER_UPSTREAM = Object.freeze({
  project: "https://poppler.freedesktop.org/",
  version: "26.09.0",
  license: "GPL-2.0-only OR GPL-3.0-only",
  mereAggregation:
    "Penglai ships pdftoppm as a separate helper binary with its dynamic-library closure. It is not linked into Electron or DSH.",
  sourceUrl: "https://poppler.freedesktop.org/poppler-26.09.0.tar.xz",
  sourceSha256: "8059eadb6805340768f138c465b57f8164c92b4a0773c37ef031ea6c0d987b2e",
  sourceBytes: 2_041_828,
  feedstock: "https://github.com/conda-forge/poppler-feedstock",
  feedstockCommit: "13d784d77510e73d6066a75a79cd8e6040a6a261",
  licenseFiles: Object.freeze({
    COPYING: "ab15fd526bd8dd18a9e77ebc139656bf4d33e97fc7238cd11bf60e2b9b8666c6",
    COPYING3: "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
  }),
  popplerData: Object.freeze({
    version: "0.4.12",
    url: "https://poppler.freedesktop.org/poppler-data-0.4.12.tar.gz",
    sha256: "c835b640a40ce357e1b83666aabd95edffa24ddddd49b8daff63adb851cdab74",
    bytes: 4_504_754,
  }),
  hostAllowlist: Object.freeze(["conda.anaconda.org", "poppler.freedesktop.org"]),
});

export const POPPLER_ASSETS = Object.freeze([
  {
    target: "darwin-aarch64",
    condaSubdir: "osx-arm64",
    filename: "poppler-26.09.0-hb6e6627_0.conda",
    url: "https://conda.anaconda.org/conda-forge/osx-arm64/poppler-26.09.0-hb6e6627_0.conda",
    archiveSha256: "0d2e5190ab4657da34560810bf326f4c5a22766152fecca603b5a06d1eba30b1",
    archiveBytes: 1_631_287,
    binaryFilename: "pdftoppm",
  },
  {
    target: "darwin-x86_64",
    condaSubdir: "osx-64",
    filename: "poppler-26.09.0-hb8a767d_0.conda",
    url: "https://conda.anaconda.org/conda-forge/osx-64/poppler-26.09.0-hb8a767d_0.conda",
    archiveSha256: "7d0f2b3de7c9d2176e6356c10b478f9d539a79368b8741e43467a6e99e4dee68",
    archiveBytes: 1_709_896,
    binaryFilename: "pdftoppm",
  },
  {
    target: "win32-x86_64",
    condaSubdir: "win-64",
    filename: "poppler-26.09.0-h924501e_0.conda",
    url: "https://conda.anaconda.org/conda-forge/win-64/poppler-26.09.0-h924501e_0.conda",
    archiveSha256: "bb319f6881d91e175f90a9d33a25313e4cfddc15dd234521519985baf92fefcd",
    archiveBytes: 2_803_695,
    binaryFilename: "pdftoppm.exe",
  },
]);

export function popplerReleaseUrl(asset) {
  return asset.url;
}

export function popplerAssetForTarget(target) {
  return POPPLER_ASSETS.find((row) => row.target === target);
}

export function popplerAssetForHost(platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && arch === "arm64") return popplerAssetForTarget("darwin-aarch64");
  if (platform === "darwin" && arch === "x64") return popplerAssetForTarget("darwin-x86_64");
  if (platform === "win32" && arch === "x64") return popplerAssetForTarget("win32-x86_64");
  return undefined;
}

export function popplerDirName(target) {
  return target;
}
