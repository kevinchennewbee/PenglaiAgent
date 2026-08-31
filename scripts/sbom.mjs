import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { MNEMON_ASSETS, MNEMON_UPSTREAM } from "../packages/release-identity/src/mnemon-assets.js";
import { collectLockPackageIds, splitLockPackageId } from "./lib/sbom-lock.mjs";

mkdirSync("evidence/generated", { recursive: true });
const lock = readFileSync("pnpm-lock.yaml", "utf8");
// Git may materialize the lockfile with CRLF on Windows. Parse logical lines,
// not host-specific bytes, so Windows release assembly cannot silently emit a
// six-component SBOM while the same source emits the full closure on macOS.
const sorted = collectLockPackageIds(lock);
const licenseEvidence = JSON.parse(readFileSync("evidence/generated/licenses.json", "utf8"));
if (licenseEvidence.schema !== 2 || !Array.isArray(licenseEvidence.completeInstalled)) {
  throw new Error("run pnpm audit:licenses before pnpm sbom");
}
const licenseByPackage = new Map();
for (const row of [...licenseEvidence.completeInstalled, ...licenseEvidence.production]) {
  licenseByPackage.set(`${row.name}@${row.version}`, row);
}
const seenRefs = new Set();
const components = sorted.map((id) => {
  const identity = splitLockPackageId(id);
  const license = licenseByPackage.get(`${identity.name}@${identity.version}`);
  const bomRef = `pkg:npm/${identity.name}@${identity.version}?pnpm_id=${encodeURIComponent(id)}`;
  if (seenRefs.has(bomRef)) throw new Error(`duplicate bom-ref ${bomRef}`);
  seenRefs.add(bomRef);
  return {
    type: "library",
    name: identity.name,
    version: identity.version,
    "bom-ref": bomRef,
    purl: bomRef,
    licenses: license
      ? [{ license: { id: license.effectiveLicense } }]
      : [{ license: { name: "NOASSERTION" } }],
    properties: license
      ? [
          { name: "penglai:license.disposition", value: license.disposition },
          { name: "penglai:license.source", value: license.source },
          { name: "penglai:lock.integrity", value: license.integrity },
        ]
      : [
          { name: "penglai:license.disposition", value: "not-materialized-on-audited-host" },
          { name: "penglai:license.review", value: "NOASSERTION disclosed; never silently accepted as production" },
        ],
  };
});
components.push({
  type: "library",
  name: "dsh-im",
  version: "3.0.5",
  "bom-ref": "pkg:github/xmanrui/dsh-im@64587b3b6162fa34f1c3ddb335a254d4154c9175",
  licenses: [{ license: { id: "MIT" } }],
  properties: [
    { name: "penglai:use", value: "selective-rewrite-not-installed" },
    { name: "penglai:tag", value: "v3.0.5" },
    { name: "penglai:tag-object", value: "63bdfc72be1289097e3c73acb95ba9260531091d" },
    { name: "penglai:unsigned-tag", value: "true" },
    { name: "penglai:archive.sha256", value: "ae4a9727627f55d5a90bff929caf27dc092153c80b8b79fca9cf18a3fa4125f7" },
    { name: "penglai:archive.bytes", value: "9835773" },
    { name: "penglai:historical-v3.0.2", value: "54468bbe1e93b30ae5778941cd65e725877dae74" },
  ],
});
const fontSource = JSON.parse(readFileSync("packages/office/fonts/SOURCE.json", "utf8"));
components.push({
  type: "file",
  name: "Noto Sans SC variable font",
  version: fontSource.upstreamCommit,
  "bom-ref": `pkg:github/notofonts/noto-cjk@${fontSource.upstreamCommit}`,
  licenses: [{ license: { id: "OFL-1.1" } }],
  properties: [
    { name: "penglai:distribution", value: "bundled-in-office-plugin" },
    { name: "penglai:upstream.file", value: fontSource.upstreamFile },
    { name: "penglai:upstream.sha256", value: fontSource.upstreamSha256 },
    { name: "penglai:bundled.sha256", value: fontSource.bundledSha256 },
    { name: "penglai:modified", value: String(fontSource.modified) },
  ],
});
components.push({
  type: "application",
  name: "Mnemon",
  version: MNEMON_UPSTREAM.version,
  "bom-ref": `pkg:github/${MNEMON_UPSTREAM.owner}/${MNEMON_UPSTREAM.repo}@${MNEMON_UPSTREAM.commit}`,
  licenses: [{ license: { id: MNEMON_UPSTREAM.license } }],
  properties: [
    { name: "penglai:distribution", value: "bundled-platform-binary" },
    { name: "penglai:upstream.tag", value: MNEMON_UPSTREAM.tag },
    { name: "penglai:license.sha256", value: MNEMON_UPSTREAM.licenseSha256 },
    ...MNEMON_ASSETS.flatMap((asset) => [
      { name: `penglai:asset:${asset.target}:archive.sha256`, value: asset.archiveSha256 },
      { name: `penglai:asset:${asset.target}:binary.sha256`, value: asset.binarySha256 },
      { name: `penglai:asset:${asset.target}:binary.bytes`, value: String(asset.binaryBytes) },
    ]),
  ],
});
components.push({
  type: "machine-learning-model",
  name: "SenseVoiceSmall int8 sherpa-onnx conversion",
  version: "2365baeacb507f821a0c8120fcee3d484dba7a07",
  "bom-ref": "pkg:huggingface/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17@2365baeacb507f821a0c8120fcee3d484dba7a07",
  licenses: [{ license: { name: "FunASR Model Open Source License Agreement 1.1" } }],
  properties: [
    { name: "penglai:distribution", value: "on-demand-not-in-installer" },
    { name: "penglai:attribution", value: "SenseVoiceSmall by FunAudioLLM and Alibaba Group" },
    { name: "penglai:model.int8.onnx.sha256", value: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51" },
    { name: "penglai:tokens.txt.sha256", value: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc" },
  ],
});
const mossFiles = [
  ["MOSS-TTS-Nano-100M-ONNX/browser_poc_manifest.json", "097d80e993dc29f0bae427590b4f77084a161cb578b50d82c29f455d5faa9eee"],
  ["MOSS-TTS-Nano-100M-ONNX/tts_browser_onnx_meta.json", "3edf25232dcd0af3d061c837e9a968a39e2f8592e06777d740503c4f2244f95c"],
  ["MOSS-TTS-Nano-100M-ONNX/tokenizer.model", "c353ee1479b536bf414c1b247f5542b6607fb8ae91320e5af1781fee200fddff"],
  ["MOSS-TTS-Nano-100M-ONNX/moss_tts_decode_step.onnx", "698cbc2fc1c2feca16e5895614ed52bbb32ded10f236c076f477b2e69abf32d8"],
  ["MOSS-TTS-Nano-100M-ONNX/moss_tts_global_shared.data", "bce8312c3df6a44545302cae229b61054fe0672e0b252ba59cba47adeed831dc"],
  ["MOSS-TTS-Nano-100M-ONNX/moss_tts_local_cached_step.onnx", "aa9035fefc1c138a951a8bcfc0374fb03a25f1ece67f7f7f53bce349b84a1dd5"],
  ["MOSS-TTS-Nano-100M-ONNX/moss_tts_local_decoder.onnx", "51aa754301b38550a5f9adda0ad93bd3dc95819afb511e6dcabf4a90b345a454"],
  ["MOSS-TTS-Nano-100M-ONNX/moss_tts_local_fixed_sampled_frame.onnx", "40cdb00efc171c450cf91468e01429caa41b0252222cd308e978f58fe354afa8"],
  ["MOSS-TTS-Nano-100M-ONNX/moss_tts_local_shared.data", "bae7782032c0fb12490ab42afe009f87ae6c75a0f0596fc7b5c08e4d5ee93916"],
  ["MOSS-TTS-Nano-100M-ONNX/moss_tts_prefill.onnx", "d56126dcd0574c2f15d98fc6b35eda68d0386b5bd9c5e38e28548d6f2ea8f3db"],
  ["MOSS-Audio-Tokenizer-Nano-ONNX/codec_browser_onnx_meta.json", "3e291c883bb7d11ff2fe8e964e3e495519760358859f35c951254c7741592731"],
  ["MOSS-Audio-Tokenizer-Nano-ONNX/moss_audio_tokenizer_decode_full.onnx", "0fbbafe3fd4afa2a019af5c5ced204af6e2d1db044fa40f021525d2aee95b4ac"],
  ["MOSS-Audio-Tokenizer-Nano-ONNX/moss_audio_tokenizer_decode_shared.data", "e69d52e0f4e84ca27850557ee54face46632d3a5a16c89bd246c7c408466dcad"],
  ["MOSS-Audio-Tokenizer-Nano-ONNX/moss_audio_tokenizer_decode_step.onnx", "9527c86a29e1837edec1f74db57d5eeaadb3a715af3382703566460afed25855"],
  ["MOSS-Audio-Tokenizer-Nano-ONNX/moss_audio_tokenizer_encode.data", "aa751265b2bab2887eac224484546b194875aa7494b607115439b3dc6b228a2c"],
  ["MOSS-Audio-Tokenizer-Nano-ONNX/moss_audio_tokenizer_encode.onnx", "eadea4a645abdcf98714c7aead122ee2ce7da6e080f9f80b977cd1ca8e19473a"],
];
for (const model of [
  {
    name: "MOSS-TTS-Nano 100M ONNX",
    repository: "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX",
    revision: "f52645cb467506d8e18e746ddd59482685b74e58",
    prefix: "MOSS-TTS-Nano-100M-ONNX/",
  },
  {
    name: "MOSS Audio Tokenizer Nano ONNX",
    repository: "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX",
    revision: "ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae",
    prefix: "MOSS-Audio-Tokenizer-Nano-ONNX/",
  },
]) {
  components.push({
    type: "machine-learning-model",
    name: model.name,
    version: model.revision,
    "bom-ref": `pkg:huggingface/${model.repository}@${model.revision}`,
    licenses: [{ license: { id: "Apache-2.0" } }],
    properties: [
      { name: "penglai:distribution", value: "on-demand-not-in-installer" },
      { name: "penglai:attribution", value: "OpenMOSS Team, Fudan University, SII and MOSI" },
      ...mossFiles
        .filter(([path]) => path.startsWith(model.prefix))
        .map(([path, digest]) => ({ name: `penglai:file:${path}:sha256`, value: digest })),
    ],
  });
}
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    component: { type: "application", name: "Penglai", version: "0.5.9" },
    tools: [{ name: "penglai-sbom", version: "0.5.9" }],
  },
  release: "0.5.9",
  lockfileSha256: createHash("sha256").update(lock).digest("hex"),
  componentCount: components.length,
  components,
};
if (lock.includes("BEGIN OPENSSH PRIVATE KEY") || lock.includes("PENGLAI_FIXTURE_UPDATER_PRIVATE")) {
  throw new Error("sbom input contained a private key");
}
writeFileSync("evidence/generated/sbom.json", JSON.stringify(sbom, null, 2));
console.log("sbom ok", components.length);
