/** Single authority for the spawned Poppler pdftoppm helper. Archive hash ≠ published tree hash. */

function conda(subdir, filename, sha256, bytes) {
  return Object.freeze({
    filename,
    subdir,
    url: `https://conda.anaconda.org/conda-forge/${subdir}/${filename}`,
    sha256,
    bytes,
  });
}

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
    licenseFiles: Object.freeze({
      COPYING: "36f27791549113cecd00013233101026452c872f79215a93d33a4a9bd0678672",
      "COPYING.adobe": "4d367131f33e9f0daa6acf84ccc20e6468aa379bc053f5fa72dab201ec017b39",
      "COPYING.gpl2": "ab15fd526bd8dd18a9e77ebc139656bf4d33e97fc7238cd11bf60e2b9b8666c6",
    }),
    dirs: Object.freeze(["cMap", "cidToUnicode", "nameToUnicode", "unicodeMap"]),
  }),
  hostAllowlist: Object.freeze(["conda.anaconda.org", "poppler.freedesktop.org"]),
  maxDownloadBytes: 20 * 1024 * 1024,
  darwinSystemRewrites: Object.freeze({
    "libc++.1.dylib": "/usr/lib/libc++.1.dylib",
    "libz.1.dylib": "/usr/lib/libz.1.dylib",
    "libcurl.4.dylib": "/usr/lib/libcurl.4.dylib",
    "libsqlite3.dylib": "/usr/lib/libsqlite3.dylib",
  }),
  darwinDlopenLibs: Object.freeze(["libfreebl3.dylib", "libnssckbi.dylib", "libnssdbm3.dylib"]),
  patches: Object.freeze([
    "conda-forge windows-data.patch (upstream, not Penglai)",
    "macOS Mach-O unsigned relocatable rewrite without codesign or install_name_tool (Penglai, documented): delete LC_CODE_SIGNATURE, keep bundled @rpath names, shrink ../lib rpath to @loader_path, map libc++/libz/libcurl/libsqlite3 to /usr/lib via command padding or header slack",
    "macOS POPPLER_DATADIR C-string → share/poppler (Penglai, documented)",
  ]),
  spawn: Object.freeze({
    cwd: "dirname(pdftoppm)",
    fontconfigPath: "fonts",
    datadir: "share/poppler (relative to cwd)",
  }),
});

const OSX_ARM64 = "osx-arm64";
const OSX_64 = "osx-64";
const WIN_64 = "win-64";

export const POPPLER_ASSETS = Object.freeze([
  Object.freeze({
    target: "darwin-aarch64",
    condaSubdir: OSX_ARM64,
    filename: "poppler-26.09.0-hb6e6627_0.conda",
    url: "https://conda.anaconda.org/conda-forge/osx-arm64/poppler-26.09.0-hb6e6627_0.conda",
    archiveSha256: "0d2e5190ab4657da34560810bf326f4c5a22766152fecca603b5a06d1eba30b1",
    archiveBytes: 1_631_287,
    binaryFilename: "pdftoppm",
    publishedTreeSha256: "7247f57887efdb11b855720a3fd08f545b0b6b7ada0a2f9fd4820bbe76f8376b",
    depends: Object.freeze([
      conda(OSX_ARM64, "libharfbuzz-14.4.0-hcda0f7c_1.conda", "a13bee65e7bcbc14b228351d3d5ba00d0c17c5840c471ab67a28b8ca930456d3", 973_351),
      conda(OSX_ARM64, "fontconfig-2.18.3-h81aa574_1.conda", "004570d35fb0eff73ce3ae49b209a47622d0c2e580dd0dc4c61d59626b386a09", 265_659),
      conda(OSX_ARM64, "libtiff-4.7.2-hf67920b_1.conda", "847d22a86ae28f66d3888702698254d25bb4eac3a0f64c1fabfb1842ac00be4c", 380_645),
      conda(OSX_ARM64, "nss-3.118-h1c710a3_0.conda", "d57f7b2cf2860a2a848e3dd43cc4f5488e60050a7d62af1834da3ee43911d9c4", 1_839_904),
      conda(OSX_ARM64, "libfreetype6-2.14.3-h2ed5691_2.conda", "d9b203d6484ad491b5b5f33d49a9d7a91189d776a9adae53d2b63af18ec11e6a", 340_923),
      conda(OSX_ARM64, "lcms2-2.19.1-hce41798_2.conda", "ee92e3ee789881b08a95d254d4dbb54186d31089743eac9bb34df45b33e5b3a2", 212_111),
      conda(OSX_ARM64, "libjpeg-turbo-3.2.0-h84a0fba_1.conda", "05006418f9392c9b723e8428808db106de0350a497832f95f921b85ff1072310", 558_459),
      conda(OSX_ARM64, "libpng-1.6.58-hf5e6511_1.conda", "f88da60b348ee1f3e1a9c20fe02142fdafe889f08da0b1cc33c1f3f14460239d", 290_219),
      conda(OSX_ARM64, "openjpeg-2.5.4-h4d1e80c_2.conda", "e71bd04b5d0e39f39a3c039d021d3b76cd65bee3032e7f859ab7082f0ace8be5", 377_958),
      conda(OSX_ARM64, "nspr-4.40-hdcbdcf5_0.conda", "429549e611c625d1f90714646b94aa62531be258b614414a54f6a402f8124c4a", 202_842),
      conda(OSX_ARM64, "libexpat-2.8.1-hf6b4638_1.conda", "5af74261101e3c777399c6294b2b5d290e508153268eb2e9ff99c4d69834612f", 69_362),
      conda(OSX_ARM64, "libintl-0.25.1-h493aca8_0.conda", "99d2cebcd8f84961b86784451b010f5f0a795ed1c08f1e7c76fbb3c22abf021a", 90_957),
      conda(OSX_ARM64, "graphite2-1.3.15-h784d473_1.conda", "471f34a187fdb4f2df33e26f2e471b16c239a5b277903f643d9c3a8c9a9f44ec", 86_493),
      conda(OSX_ARM64, "libglib-2.88.3-h81decf1_3.conda", "aad240a33afc71c0c9cefea5304c917c256518e6724cd646d924838fdff1fcb3", 4_443_129),
      conda(OSX_ARM64, "lerc-4.2.0-h1eee2c3_0.conda", "c97aa17d16d2ac332ba9f184e82ce8f72dcb10e9a10c5f299030be2d44e191b9", 166_477),
      conda(OSX_ARM64, "libdeflate-1.25-he7e0567_1.conda", "d896f4aa4ce4c590c2838678cb1917356fdb461d2a189991c0280c818c362172", 55_727),
      conda(OSX_ARM64, "libwebp-base-1.6.0-h202fb40_1.conda", "0ff54650d470c7e54cbeffdd53a8c063e055a7bcf784388c0385ce5c4741b0f4", 294_522),
      conda(OSX_ARM64, "zstd-1.5.7-hf451053_7.conda", "da867f5092eb0cb746d353694f0098031fd9817a4ce7d5743121209ae0f406ca", 433_687),
      conda(OSX_ARM64, "liblzma-5.8.3-h8088a28_1.conda", "23d0630046a3e8b164d8f80f2b74ed2605af2e7050ab9913018056402fae4311", 91_720),
      conda(OSX_ARM64, "pcre2-10.47-he63d830_1.conda", "f8c415329b542e1fca1ff2917b80e687c18302dfa0353530668b90cb225b494f", 851_704),
      conda(OSX_ARM64, "libiconv-1.18-he4c29f2_3.conda", "689a14968267f2f97c07112fca5636e7d756036b9aee969911267c20bd3eea1f", 750_816),
    ]),
  }),
  Object.freeze({
    target: "darwin-x86_64",
    condaSubdir: OSX_64,
    filename: "poppler-26.09.0-hb8a767d_0.conda",
    url: "https://conda.anaconda.org/conda-forge/osx-64/poppler-26.09.0-hb8a767d_0.conda",
    archiveSha256: "7d0f2b3de7c9d2176e6356c10b478f9d539a79368b8741e43467a6e99e4dee68",
    archiveBytes: 1_709_896,
    binaryFilename: "pdftoppm",
    publishedTreeSha256: "9be2eeb24236b27b4ec14632e6f353f57551c984248d1d4010dbdae83108e862",
    depends: Object.freeze([
      conda(OSX_64, "libharfbuzz-14.4.0-h2974713_1.conda", "a4e18affbd1725cd55928cec10685eff419ebcc80ec1feac3d08875d192d0b44", 1_101_693),
      conda(OSX_64, "fontconfig-2.18.3-h7f3b9c9_1.conda", "4637141fa4f3a0f9b58afe4bda831adcb6964495600e97e7e2ed9763cd4f7eda", 264_035),
      conda(OSX_64, "libtiff-4.7.2-h01c3a8c_1.conda", "661b0befbb6e2300e0d25d9aac8f66be7003297c757fbb3e016985bf43a72638", 409_602),
      conda(OSX_64, "nss-3.118-h2b2a826_0.conda", "5107dd376fbbed40a0556835e7ff25d09a4931f339a075167ebf370bbc945390", 1_927_429),
      conda(OSX_64, "libfreetype6-2.14.3-h8afe040_2.conda", "9c81d42ca311a1283fb8f79d05dae5659d86cf20f4e5d146a97836456537ccff", 366_001),
      conda(OSX_64, "lcms2-2.19.1-h4e6bd4b_2.conda", "a05629542fe1f014ef552d02eedb4f6afcc3ab7aa22fd261114a024073c53737", 225_059),
      conda(OSX_64, "libjpeg-turbo-3.2.0-ha1e9b39_1.conda", "0792824360a9e59802c9464157c1098c3d84330dcab5dbde762abaca16f580a8", 614_315),
      conda(OSX_64, "libpng-1.6.58-h4382c61_1.conda", "4677159f77da07eba37618f2e0c9887233dacf5e23290bb6d978732d0f5f896d", 298_934),
      conda(OSX_64, "openjpeg-2.5.4-he4eae51_1.conda", "2d9eef746dc20c5e829b0b10de6731c5c5ab01c55160364ecf05a1bfaea0cca6", 333_801),
      conda(OSX_64, "nspr-4.40-h8ea0cdc_0.conda", "f89354d951659dcc7a663a90d40daf7f457555890aee983b2a258f1de47d012d", 208_002),
      conda(OSX_64, "libexpat-2.8.1-hcc62823_1.conda", "9c96cc05e056e1bba5b545cbbd57b6e01db622dc2c82934caaaa25cfb22fe666", 76_020),
      conda(OSX_64, "libintl-0.25.1-h3184127_1.conda", "8c352744517bc62d24539d1ecc813b9fdc8a785c780197c5f0b84ec5b0dfe122", 96_909),
      conda(OSX_64, "graphite2-1.3.15-h2fb4741_1.conda", "8cc44569368289870f3cfe4a56f543ec15468398133545eae8d8c3ca4ef87774", 91_460),
      conda(OSX_64, "libglib-2.88.3-hf4b7cfa_3.conda", "061a60ad582fb5bd287090b8d6df2ac21d04175ac2b437655ecb2e08a7c7130b", 4_520_637),
      conda(OSX_64, "lerc-4.2.0-h35c7297_0.conda", "5ae9e18ec7f8134a009765bd1454687d5057482fbe9a4c661a672746d4a29b0b", 217_900),
      conda(OSX_64, "libdeflate-1.25-h7ad9622_1.conda", "210ee1d6a5aa201cf6d02b10edd02738cc35a4e8fb0866e4fb425010d6dd2c49", 71_148),
      conda(OSX_64, "libwebp-base-1.6.0-hb276fe9_1.conda", "96263e9134164b6ca015a8cfba3a4cac9ca2429ddfebd25c120817fa608d2fdc", 364_823),
      conda(OSX_64, "zstd-1.5.7-hbc1a06c_7.conda", "5277886d9704a624dc9b79ac985861e1e431bdb39a57c082507ab577a138ec6c", 528_228),
      conda(OSX_64, "liblzma-5.8.3-hbb4bfdb_1.conda", "7915dac7c71c208e40e716e2f6d3eff41a8d5584e0e7c2d46f9bf9bd5f9aa739", 104_919),
      conda(OSX_64, "pcre2-10.47-h31793e3_1.conda", "9b3d0022e9f97939f7ea46661a4ef340c41ea137976bd38cfc4f7c5808a335d9", 1_113_605),
      conda(OSX_64, "libiconv-1.18-h4ae439b_3.conda", "2389e03a58ed0f5e8f2469eb4d4ba80d0af378b38854ae5eee65e5b641244082", 736_150),
    ]),
  }),
  Object.freeze({
    target: "win32-x86_64",
    condaSubdir: WIN_64,
    filename: "poppler-26.09.0-h924501e_0.conda",
    url: "https://conda.anaconda.org/conda-forge/win-64/poppler-26.09.0-h924501e_0.conda",
    archiveSha256: "bb319f6881d91e175f90a9d33a25313e4cfddc15dd234521519985baf92fefcd",
    archiveBytes: 2_803_695,
    binaryFilename: "pdftoppm.exe",
    publishedTreeSha256: "eb21fe335cec4e3b27728e92c5b08eec0ba36374359b798adaa41f97c29b8ac3",
    depends: Object.freeze([
      conda(WIN_64, "lcms2-2.19.1-hf2c6c5f_2.conda", "df1c1a4dd44c54f238dc0a230d31eab9e73ada472dc4fa357552333b35641804", 523_808),
      conda(WIN_64, "libfreetype6-2.14.3-hdbac1cb_2.conda", "cbc650854003e434d4ff6c7b1a2667e38a4242ad8a391a1c5ff89721624065ce", 340_385),
      conda(WIN_64, "libzlib-1.3.2-hfd05255_3.conda", "0629c2cc0404d3bb29d6baa7b4ba62da80797015e86de050db81ea5a07050527", 58_529),
      conda(WIN_64, "libjpeg-turbo-3.2.0-hfd05255_1.conda", "df78ab4c0eecb3dd9331898f96baeed8e5ca1c363346332517abeb0b614b9a53", 990_125),
      conda(WIN_64, "libcurl-8.22.0-hdb0ef4a_0.conda", "5fe063cffa90ad3ef04e25c76b1a79cdbc4f6c43747164a7dcdd89c4faebb84e", 413_226),
      conda(WIN_64, "openjpeg-2.5.4-h90fa87c_2.conda", "d1c630ccd9ae0898b48d84e986f4c330f66a25e535f99efe8cbf03f042b33da5", 274_994),
      conda(WIN_64, "libpng-1.6.58-hdc8cecf_1.conda", "8c49c32adf3ba2c59783630b82377f54ab72204ea99e2bafc90a47a8e25c1032", 385_462),
      conda(WIN_64, "libtiff-4.7.2-h8f73337_1.conda", "3575a092e3e52625a1767804a4ebd321becaadf61b63dcd6735ebb88c0b3c359", 1_014_211),
      conda(WIN_64, "lerc-4.2.0-hd936e49_0.conda", "93d666f63f284ef77b87b0b1f77b70f7d36d315a132f9afa64bc0012d937ba39", 175_297),
      conda(WIN_64, "libdeflate-1.25-h1a1d4e4_1.conda", "af1cda21d4653f594fbef20aa4e1ff158a546902b3307ef8af9a9b44b43862d2", 157_828),
      conda(WIN_64, "liblzma-5.8.3-hfd05255_1.conda", "d36c4a1e1f80fd08e18a407e03622ff2f34dfdd022da6488ad19603dea19e6d5", 105_809),
      conda(WIN_64, "zstd-1.5.7-h534d264_7.conda", "ca7daae4f218a11fab82cc2857f0ea518ec3f46acec60490485347a4c22c6b3e", 387_535),
      conda(WIN_64, "libssh2-1.11.1-h734d217_1.conda", "1097b08429b4f53f5751a32c6d99a083d227ca7f7812c0b239eea124cec073a0", 295_149),
      conda(WIN_64, "libpsl-0.23.1-h9b16d47_1.conda", "e53fe3b09f82b59b644264133d6d148ac31bb5451b7583cff55690bf038f2f62", 73_511),
      conda(WIN_64, "openssl-3.5.8-hf411b9b_0.conda", "778f55e8fe29ec1bef0e30027ef19c38afb49c5d9d7c22019ea350e56def0279", 9_309_552),
      conda(WIN_64, "icu-78.3-h5112557_2.conda", "75c549b55b673e15de8785a8e5dd85bca7eb612eee0ff4dc8d7bdaa15eacbdbb", 16_835_644),
    ]),
  }),
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

export function popplerAllCondaPackages(asset) {
  return [
    conda(asset.condaSubdir, asset.filename, asset.archiveSha256, asset.archiveBytes),
    ...asset.depends,
  ];
}
