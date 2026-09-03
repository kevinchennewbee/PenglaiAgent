import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SENSEVOICE_REPOSITORY, SENSEVOICE_REVISION } from "../packages/asr/src/models.ts";
import {
  MOSS_CODEC_REPOSITORY,
  MOSS_CODEC_REVISION,
  MOSS_TTS_REPOSITORY,
  MOSS_TTS_REVISION,
} from "../packages/moss-tts/src/models.ts";
import { MNEMON_UPSTREAM } from "../packages/release-identity/src/mnemon-assets.js";

const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
const release = JSON.parse(readFileSync("release-contract.json", "utf8"));
const office = JSON.parse(readFileSync("packages/office/package.json", "utf8"));
const feishu = JSON.parse(readFileSync("packages/channel-feishu/package.json", "utf8"));
const font = JSON.parse(readFileSync("packages/office/fonts/SOURCE.json", "utf8"));
const penglaiLicense = readFileSync("LICENSE", "utf8").trim();
const licenseEvidence = JSON.parse(readFileSync("evidence/generated/licenses.json", "utf8"));
if (licenseEvidence.schema !== 2 || !Array.isArray(licenseEvidence.production)) {
  throw new Error("run pnpm audit:licenses before pnpm notices");
}

const dependency = (manifest, name) => {
  const version = manifest.dependencies?.[name];
  if (typeof version !== "string" || version.includes("workspace:")) {
    throw new Error(`third-party notice dependency missing: ${name}`);
  }
  return version;
};

const text = `Penglai ${rootPackage.version} Third-Party Notices
${"=".repeat(`Penglai ${rootPackage.version} Third-Party Notices`.length)}

Source SHA: ${licenseEvidence.sourceSha}
Audited target: ${licenseEvidence.target}

This distribution contains or interoperates with software, fonts, and model
artifacts from third parties. This notice records the exact versions, immutable
source pins, licenses, and distribution mode audited for the three-platform
Penglai ${rootPackage.version} community release. The complete machine-readable
inventory is in SBOM.cdx.json. Full license and provenance texts are retained in
the public source and, where required, next to the packaged component.

Core runtime
------------

- DeepSeek Harness ${release.dshVersion} - MIT:
  https://github.com/deepseek-ai/deepseek-harness
- Electron ${release.electronVersion} - MIT. Chromium notices remain inside the
  application resources: https://github.com/electron/electron
- Node.js ${release.nodeVersion} - licenses and notices remain inside the
  embedded runtime: https://github.com/nodejs/node
- sharp 0.35.4 and its dynamically linked libvips 8.18.6 shared libraries
  are used by official DSH attachment support. The sharp addon is Apache-2.0;
  libvips is LGPL-2.1-or-later, while sharp-libvips uses the LGPLv3 option for
  the LGPL components listed in its third-party notice. Exact upstream legal
  texts are packaged under licenses/sharp/, and the source identities and
  replacement rights are recorded in LGPL_SOURCE_OFFER.txt.
- TypeScript - Apache-2.0: https://github.com/microsoft/TypeScript
- tsx - MIT: https://github.com/privatenumber/tsx

Messaging protocol and SDK references
--------------------------------------

- Tencent openclaw-weixin protocol reference - MIT; commit
  cef0bfc390393f716903e16d50408118047f87e0. Penglai implements the required
  iLink HTTP/JSON subset and does not vendor the OpenClaw plugin runtime:
  https://github.com/Tencent/openclaw-weixin
- Lark Node SDK ${dependency(feishu, "@larksuiteoapi/node-sdk")} - MIT; commit
  f54b49f3566c52b54c598194b7ed3015e3e24224:
  https://github.com/larksuite/node-sdk
Penglai Office
--------------

- docx ${dependency(office, "docx")} - MIT: https://github.com/dolanmiu/docx
- ExcelJS ${dependency(office, "exceljs")} - MIT: https://github.com/exceljs/exceljs
- uuid 11.1.1 - MIT; security-pinned transitive dependency used by ExcelJS:
  https://github.com/uuidjs/uuid
- pptfast ${dependency(office, "@liustack/pptfast")} - MIT; commit
  7482c83436531530b46003ccdab62b1fa8c97969:
  https://github.com/liustack/pptfast
  Penglai bundles a deterministic Node runtime generated from that exact
  package, plus the license text for every npm package included in the bundle.
  Image probing is deliberately unavailable in 0.5.10: PPTX creation is text
  only, so vulnerable optional image-size and Sharp paths are not shipped.
- pdf-lib ${dependency(office, "pdf-lib")} and @pdf-lib/fontkit
  ${dependency(office, "@pdf-lib/fontkit")} - MIT:
  https://github.com/Hopding/pdf-lib
- Noto Sans SC variable font - OFL-1.1; commit ${font.upstreamCommit}; bundled
  unmodified SHA-256 ${font.bundledSha256}. The font, OFL text, and attribution
  notice are inside the Office plugin:
  ${font.upstreamRepo}

Penglai Memory
--------------

- Mnemon ${MNEMON_UPSTREAM.version} - Apache-2.0; commit
  ${MNEMON_UPSTREAM.commit}. One hash-pinned native binary is bundled for each
  supported platform, with the exact Apache-2.0 license stored beside it:
  https://github.com/${MNEMON_UPSTREAM.owner}/${MNEMON_UPSTREAM.repo}

Local speech recognition
------------------------

- sherpa-onnx 1.13.5 - Apache-2.0:
  https://github.com/k2-fsa/sherpa-onnx
- SenseVoiceSmall int8 weights - FunASR Model Open Source License Agreement
  1.1; revision ${SENSEVOICE_REVISION}. Attribution: SenseVoiceSmall by
  FunAudioLLM and Alibaba Group. Model weights download only after explicit
  user action and are not inside the installer:
  https://huggingface.co/${SENSEVOICE_REPOSITORY}

Local speech synthesis
----------------------

- MOSS-TTS-Nano modified Node runtime - Apache-2.0; algorithm source commit
  cc7bdf19c7639c0870dab22045a33b442760f6be; runtime source commit
  c3b2333b88e0f062ca49d403540a169609354d93:
  https://github.com/OpenMOSS/MOSS-TTS-Nano
- MOSS-TTS-Nano 100M ONNX weights - Apache-2.0; revision
  ${MOSS_TTS_REVISION}. Weights download only after explicit user action and
  are not inside the installer: https://huggingface.co/${MOSS_TTS_REPOSITORY}
- MOSS Audio Tokenizer Nano ONNX weights - Apache-2.0; revision
  ${MOSS_CODEC_REVISION}. Weights download only after explicit user action and
  are not inside the installer: https://huggingface.co/${MOSS_CODEC_REPOSITORY}
- onnxruntime-node 1.23.2 - MIT:
  https://github.com/microsoft/onnxruntime
- sentencepiece-js 1.1.0 - Apache-2.0:
  https://github.com/JanKaul/sentencepiece

Audio codecs
------------

- silk-wasm 3.7.1 - MIT: https://github.com/idranme/silk-wasm
- libopus-wasm 0.2.0 - MIT; upstream commit
  55fe0b6faf9043518b7e1a7ea32e74659ecfbae7. Upstream libopus notices remain
  inside the Mobile Messaging plugin: https://github.com/openclaw/libopus-wasm

Plugin Center transition
------------------------

Penglai Office and Penglai Memory are first-party bundled plugins in 0.5.10.
The former remote @penglai/office-reader package is not part of this desktop
Release. Historical immutable catalog Releases remain available for audit;
catalog 000006 revokes that obsolete exact artifact after 0.5.5 is public.

Complete production dependency inventory
----------------------------------------

Generated from \`pnpm licenses list --prod --json\`. Each row records the
exact version, selected/effective license, source, lockfile integrity, and
distribution disposition. \`excluded-from-release\` means the dependency is
present in the source production closure but is mechanically excluded from
the installer/plugin bytes.

${licenseEvidence.production
  .map(
    (row) =>
      `- ${row.name} ${row.version} - ${row.effectiveLicense}; ${row.disposition}; source ${row.source}; integrity ${row.integrity}`,
  )
  .join("\n")}

Penglai license
---------------

${penglaiLicense}
`;

mkdirSync("evidence/generated", { recursive: true });
writeFileSync("evidence/generated/THIRD_PARTY_NOTICES.txt", text);
console.log("third-party notices ok", rootPackage.version);
