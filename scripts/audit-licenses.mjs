import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { MNEMON_ASSETS, MNEMON_UPSTREAM } from "../packages/release-identity/src/mnemon-assets.js";

mkdirSync("evidence/generated", { recursive: true });
const req = createRequire(`${process.cwd()}/package.json`);
const asrReq = createRequire(`${process.cwd()}/packages/asr/package.json`);
const mossReq = createRequire(`${process.cwd()}/packages/moss-tts/package.json`);
const audioReq = createRequire(`${process.cwd()}/packages/audio-codecs/package.json`);
const officeReq = createRequire(`${process.cwd()}/packages/office/package.json`);
const feishuReq = createRequire(`${process.cwd()}/packages/channel-feishu/package.json`);
const FUNASR_LICENSE_SHA256 = "7dba975a2069691db4992b0592d70828b330d2f8a30a71450f4e152a554e84f8";
const SHERPA_LICENSE_SHA256 = "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30";
const SHERPA_INTEGRITY = "sha512-kq3HgrXdbYCgK44U0gd2Cpnahf7qa59caPnROI7dy1+nKou8KdAsV9yUsCScZqTewvRyR/khUS97X26KE4JRMw==";
const ONNX_RUNTIME_INTEGRITY = "sha512-OBTsG0W8ddBVOeVVVychpVBS87A9YV5sa2hJ6lc025T97Le+J4v++PwSC4XFs1C62SWyNdof0Mh4KvnZgtt4aw==";
const SENTENCEPIECE_INTEGRITY = "sha512-HN6teKCRO9tz37zbaNI3i+vMZ/JRWDt6kmZ7OVpzQv1jZHyYNmf5tE7CFpIYN86+y9TLB0cuscMdA3OHhT/MhQ==";
const MOSS_SOURCE_COMMIT = "cc7bdf19c7639c0870dab22045a33b442760f6be";
const MOSS_TTS_REVISION = "f52645cb467506d8e18e746ddd59482685b74e58";
const MOSS_CODEC_REVISION = "ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae";
const MOSS_RUNTIME_COMMIT = "c3b2333b88e0f062ca49d403540a169609354d93";
const MOSS_UPSTREAM_LICENSE_SHA256 = "1dc6904a1959e039b44569c6a726a611f75287051284de1b6cc0dc7712b14d11";
const SILK_INTEGRITY = "sha512-mXPwLRtZxrYV3TZx41jMAeKc80wvmyrcXIcs8HctFxK15Ahz2OJQENYhNgEPeCEOdI6Mbx1NxQsqxzwc3DKerw==";
const LIBOPUS_INTEGRITY = "sha512-x/2Gu1/C6L3IICY09zyfp984AWiOYjn53u4WfdY3yh+3KTzMN8Xkm77q3lenWMVIk5SnSzjGEkQT+VQMFHLBHQ==";
const NOTO_CJK_SHA256 = "d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964";
const NOTO_OFL_SHA256 = "6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2";

function packageInfoFor(
  packageName,
  resolver = mossReq,
  fromDir = join(process.cwd(), "packages/moss-tts"),
) {
  const linked = join(fromDir, "node_modules", ...packageName.split("/"));
  if (existsSync(join(linked, "package.json"))) {
    const root = dirname(realpathSync(join(linked, "package.json")));
    return { root, pkg: JSON.parse(readFileSync(join(root, "package.json"), "utf8")) };
  }
  let cursor = dirname(resolver.resolve(packageName));
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = join(cursor, "package.json");
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf8"));
      if (pkg.name === packageName) return { root: cursor, pkg };
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(`cannot resolve package metadata for ${packageName}`);
}

function packageJsonFor(packageName, resolver = mossReq, fromDir) {
  return packageInfoFor(packageName, resolver, fromDir).pkg;
}

const licenses = [
  { name: "penglai-v2", license: "MIT" },
  { name: "@deepseek-ai/dsh", license: "MIT", pin: "0.1.1-rc.2" },
  { name: "@deepseek-ai/dsh-agent", license: "MIT", pin: "0.1.1-rc.2" },
  { name: "@deepseek-ai/dsh-llm", license: "MIT", pin: "0.1.1-rc.2" },
  { name: "@deepseek-ai/dsh-workspace", license: "MIT", pin: "0.1.1-rc.2" },
  { name: "Tencent openclaw-weixin protocol reference", license: "MIT", commit: "cef0bfc390393f716903e16d50408118047f87e0" },
  { name: "typescript", license: "Apache-2.0" },
  { name: "tsx", license: "MIT" },
  { name: "electron", license: "MIT", pin: "43.4.0" },
  {
    name: "@larksuiteoapi/node-sdk",
    license: "MIT",
    pin: "1.73.0",
    commit: "f54b49f3566c52b54c598194b7ed3015e3e24224",
    bundledInInstaller: true,
  },
  { name: "docx", license: "MIT", pin: "9.7.1", bundledInInstaller: true },
  { name: "exceljs", license: "MIT", pin: "4.4.0", bundledInInstaller: true },
  { name: "uuid", license: "MIT", pin: "11.1.1", bundledInInstaller: true },
  { name: "@liustack/pptfast", license: "MIT", pin: "0.20.0", bundledInInstaller: true },
  { name: "pdf-lib", license: "MIT", pin: "1.17.1", bundledInInstaller: true },
  { name: "@pdf-lib/fontkit", license: "MIT", pin: "1.1.1", bundledInInstaller: true },
  {
    name: "Noto Sans SC variable font",
    license: "OFL-1.1",
    commit: "f8d157532fbfaeda587e826d4cd5b21a49186f7c",
    sha256: NOTO_CJK_SHA256,
    licenseSha256: NOTO_OFL_SHA256,
    bundledInInstaller: true,
  },
  {
    name: "Mnemon",
    license: MNEMON_UPSTREAM.license,
    pin: MNEMON_UPSTREAM.version,
    commit: MNEMON_UPSTREAM.commit,
    licenseSha256: MNEMON_UPSTREAM.licenseSha256,
    bundledInInstaller: true,
    assets: MNEMON_ASSETS.map((asset) => ({
      target: asset.target,
      archiveSha256: asset.archiveSha256,
      binarySha256: asset.binarySha256,
    })),
  },
  {
    name: "sherpa-onnx",
    license: "Apache-2.0",
    pin: "1.13.5",
    integrity: SHERPA_INTEGRITY,
    licenseSha256: SHERPA_LICENSE_SHA256,
  },
  {
    name: "SenseVoiceSmall int8 weights",
    license: "FunASR-Model-License-1.1",
    commit: "2365baeacb507f821a0c8120fcee3d484dba7a07",
    licenseSourceCommit: "58830eca4012644aac0c3218c3ccc7d98f003fda",
    licenseSha256: FUNASR_LICENSE_SHA256,
    attribution: "SenseVoiceSmall by FunAudioLLM and Alibaba Group",
    bundledInInstaller: false,
  },
  {
    name: "onnxruntime-node",
    license: "MIT",
    pin: "1.23.2",
    integrity: ONNX_RUNTIME_INTEGRITY,
    licenseSha256: "2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c",
    bundledInInstaller: true,
  },
  {
    name: "sentencepiece-js",
    license: "Apache-2.0",
    pin: "1.1.0",
    integrity: SENTENCEPIECE_INTEGRITY,
    licenseSha256: "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
    bundledInInstaller: true,
  },
  {
    name: "silk-wasm",
    license: "MIT",
    pin: "3.7.1",
    integrity: SILK_INTEGRITY,
    licenseSha256: "3b1585c0e6d9d501e86383948fc0d1734bcb86517a13111d97749c65ad2bfb74",
    wasmSha256: "88152af59af535b8056ac806710824b2259a361027451b494f175f48fb39c807",
    bundledInInstaller: true,
  },
  {
    name: "libopus-wasm",
    license: "MIT",
    pin: "0.2.0",
    commit: "55fe0b6faf9043518b7e1a7ea32e74659ecfbae7",
    integrity: LIBOPUS_INTEGRITY,
    licenseSha256: "6ae2daf92d73e912aef033d56ce374df997ae0ad1d88ca9ef76f0c11123aae27",
    noticesSha256: "e1aa9531a6cd740a76f54a06903d76dbec8b218307030c8444f2570932fafec8",
    upstreamModuleSha256: "7f254556d782ac20a304068d4ecf7a1b9e6e94df5694f550e6d14c217d7e2028",
    packedModuleSha256: "ded4c50a60e4848919d093890563b623404bb9a1bf9e039845603f1ecb282fa5",
    transform: "same-length removal of upstream absolute build paths from debug strings",
    bundledInInstaller: true,
  },
  {
    name: "MOSS-TTS-Nano modified Node runtime",
    license: "Apache-2.0",
    sourceCommit: MOSS_SOURCE_COMMIT,
    runtimeCommit: MOSS_RUNTIME_COMMIT,
    runtimeSha256: "b49d214bbe9ba9849d48e1588c66a70173eee76c211bb4f473b5eadf7bce038c",
    upstreamLicenseSha256: MOSS_UPSTREAM_LICENSE_SHA256,
    bundledInInstaller: true,
  },
  {
    name: "MOSS-TTS-Nano 100M ONNX weights",
    license: "Apache-2.0",
    repository: "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX",
    commit: MOSS_TTS_REVISION,
    licenseSourceCommit: MOSS_SOURCE_COMMIT,
    licenseSha256: MOSS_UPSTREAM_LICENSE_SHA256,
    attribution: "OpenMOSS Team, Fudan University, SII and MOSI",
    bundledInInstaller: false,
  },
  {
    name: "MOSS Audio Tokenizer Nano ONNX weights",
    license: "Apache-2.0",
    repository: "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX",
    commit: MOSS_CODEC_REVISION,
    licenseSourceCommit: MOSS_SOURCE_COMMIT,
    licenseSha256: MOSS_UPSTREAM_LICENSE_SHA256,
    attribution: "OpenMOSS Team, Fudan University, SII and MOSI",
    bundledInInstaller: false,
  },
];
for (const item of licenses) {
  if (!item.name.startsWith("@deepseek") && item.name !== "electron") continue;
  try {
    const p = req.resolve(`${item.name}/package.json`);
    const pkg = JSON.parse(readFileSync(p, "utf8"));
    if (pkg.license && pkg.license !== "MIT" && pkg.license !== "Apache-2.0") {
      console.error("unexpected license", item.name, pkg.license);
      process.exit(1);
    }
  } catch {
    if (!existsSync("node_modules")) {
      console.error("missing node_modules for license check");
      process.exit(1);
    }
  }
}
const sherpaPkg = JSON.parse(
  readFileSync(asrReq.resolve("sherpa-onnx/package.json"), "utf8"),
);
if (sherpaPkg.version !== "1.13.5" || sherpaPkg.license !== "Apache-2.0") {
  console.error("unexpected sherpa-onnx version/license", sherpaPkg.version, sherpaPkg.license);
  process.exit(1);
}
const onnxPkg = packageJsonFor("onnxruntime-node");
const sentencepiecePkg = packageJsonFor("sentencepiece-js");
const audioDir = join(process.cwd(), "packages/audio-codecs");
const silkInfo = packageInfoFor("silk-wasm", audioReq, audioDir);
const opusInfo = packageInfoFor("libopus-wasm", audioReq, audioDir);
const excelInfo = packageInfoFor(
  "exceljs",
  officeReq,
  join(process.cwd(), "packages/office"),
);
const excelReq = createRequire(join(excelInfo.root, "package.json"));
const uuidInfo = packageInfoFor("uuid", excelReq, excelInfo.root);
if (onnxPkg.version !== "1.23.2" || onnxPkg.license !== "MIT") {
  console.error("unexpected onnxruntime-node version/license", onnxPkg.version, onnxPkg.license);
  process.exit(1);
}
if (sentencepiecePkg.version !== "1.1.0" || sentencepiecePkg.license !== "Apache-2.0") {
  console.error(
    "unexpected sentencepiece-js version/license",
    sentencepiecePkg.version,
    sentencepiecePkg.license,
  );
  process.exit(1);
}
if (silkInfo.pkg.version !== "3.7.1" || silkInfo.pkg.license !== "MIT") {
  console.error("unexpected silk-wasm version/license", silkInfo.pkg.version, silkInfo.pkg.license);
  process.exit(1);
}
if (opusInfo.pkg.version !== "0.2.0" || opusInfo.pkg.license !== "MIT") {
  console.error("unexpected libopus-wasm version/license", opusInfo.pkg.version, opusInfo.pkg.license);
  process.exit(1);
}
if (uuidInfo.pkg.version !== "11.1.1" || uuidInfo.pkg.license !== "MIT") {
  console.error("unexpected uuid version/license", uuidInfo.pkg.version, uuidInfo.pkg.license);
  process.exit(1);
}
for (const [resolver, fromDir, name, version, license] of [
  [feishuReq, join(process.cwd(), "packages/channel-feishu"), "@larksuiteoapi/node-sdk", "1.73.0", "MIT"],
  [officeReq, join(process.cwd(), "packages/office"), "docx", "9.7.1", "MIT"],
  [officeReq, join(process.cwd(), "packages/office"), "exceljs", "4.4.0", "MIT"],
  [officeReq, join(process.cwd(), "packages/office"), "@liustack/pptfast", "0.20.0", "MIT"],
  [officeReq, join(process.cwd(), "packages/office"), "pdf-lib", "1.17.1", "MIT"],
  [officeReq, join(process.cwd(), "packages/office"), "@pdf-lib/fontkit", "1.1.1", "MIT"],
]) {
  const metadata = packageInfoFor(name, resolver, fromDir).pkg;
  if (metadata.version !== version || metadata.license !== license) {
    console.error("unexpected package version/license", name, metadata.version, metadata.license);
    process.exit(1);
  }
}
const fontSource = JSON.parse(readFileSync("packages/office/fonts/SOURCE.json", "utf8"));
const mnemonManifest = JSON.parse(readFileSync("third_party/mnemon/manifest.json", "utf8"));
if (
  fontSource.license !== "OFL-1.1" ||
  fontSource.upstreamSha256 !== NOTO_CJK_SHA256 ||
  fontSource.bundledSha256 !== NOTO_CJK_SHA256 ||
  MNEMON_UPSTREAM.license !== "Apache-2.0" ||
  mnemonManifest.license !== MNEMON_UPSTREAM.license ||
  mnemonManifest.licenseSha256 !== MNEMON_UPSTREAM.licenseSha256 ||
  mnemonManifest.commit !== MNEMON_UPSTREAM.commit ||
  MNEMON_ASSETS.length !== 3
) {
  console.error("Office font or Mnemon license provenance drift");
  process.exit(1);
}
const lock = readFileSync("pnpm-lock.yaml", "utf8");
if (!lock.includes(`sherpa-onnx@1.13.5:`) || !lock.includes(`integrity: ${SHERPA_INTEGRITY}`)) {
  console.error("sherpa-onnx lock integrity missing");
  process.exit(1);
}
for (const [name, version, integrity] of [
  ["onnxruntime-node", "1.23.2", ONNX_RUNTIME_INTEGRITY],
  ["sentencepiece-js", "1.1.0", SENTENCEPIECE_INTEGRITY],
  ["silk-wasm", "3.7.1", SILK_INTEGRITY],
  ["libopus-wasm", "0.2.0", LIBOPUS_INTEGRITY],
]) {
  if (!lock.includes(`${name}@${version}:`) || !lock.includes(`integrity: ${integrity}`)) {
    console.error(`${name} lock integrity missing`);
    process.exit(1);
  }
}
for (const [path, expected] of [
  [join(silkInfo.root, "LICENSE"), "3b1585c0e6d9d501e86383948fc0d1734bcb86517a13111d97749c65ad2bfb74"],
  [join(silkInfo.root, "lib/silk.wasm"), "88152af59af535b8056ac806710824b2259a361027451b494f175f48fb39c807"],
  [join(opusInfo.root, "LICENSE"), "6ae2daf92d73e912aef033d56ce374df997ae0ad1d88ca9ef76f0c11123aae27"],
  [join(opusInfo.root, "THIRD_PARTY_NOTICES.md"), "e1aa9531a6cd740a76f54a06903d76dbec8b218307030c8444f2570932fafec8"],
]) {
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual !== expected) {
    console.error("audio codec license/runtime hash mismatch", path, actual);
    process.exit(1);
  }
}
for (const [path, expected] of [
  ["packages/asr/third_party/FunASR-MODEL_LICENSE-1.1.txt", FUNASR_LICENSE_SHA256],
  ["packages/asr/third_party/sherpa-onnx-Apache-2.0.txt", SHERPA_LICENSE_SHA256],
  ["packages/moss-tts/third_party/OpenMOSS-Apache-2.0.txt", "e83b87b4c86fc39a3e3278705e02f3599d63b0a9fd006a6ec7aa721d38d4086d"],
  ["packages/moss-tts/third_party/onnxruntime-MIT.txt", "2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c"],
  ["packages/moss-tts/third_party/sentencepiece-js-Apache-2.0.txt", "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4"],
  ["packages/moss-tts/src/third_party/moss_tts/LICENSE", "e83b87b4c86fc39a3e3278705e02f3599d63b0a9fd006a6ec7aa721d38d4086d"],
  ["packages/moss-tts/src/third_party/moss_tts/runtime.mjs", "b49d214bbe9ba9849d48e1588c66a70173eee76c211bb4f473b5eadf7bce038c"],
  ["packages/moss-tts/third_party/PROVENANCE.md", "d14085661d78d7c473d30c91a762d88a80407d9cae9f066648cf323d81064fdb"],
  ["packages/office/fonts/NotoSansSC-VF.ttf", NOTO_CJK_SHA256],
  ["packages/office/fonts/OFL.txt", NOTO_OFL_SHA256],
  ["packages/moss-tts/third_party/sentencepiece-js-Apache-2.0.txt", MNEMON_UPSTREAM.licenseSha256],
]) {
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual !== expected) {
    console.error("third-party license hash mismatch", path, actual);
    process.exit(1);
  }
}
writeFileSync("evidence/generated/licenses.json", JSON.stringify(licenses, null, 2));
console.log("audit:licenses ok");
