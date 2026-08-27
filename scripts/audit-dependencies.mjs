import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { resolvePackageMetadata } from "./lib/package-metadata.mjs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const npmrc = readFileSync(".npmrc", "utf8");
if (!/^ignore-scripts=true$/m.test(npmrc)) {
  console.error("install scripts must stay disabled");
  process.exit(1);
}
const mossReq = createRequire(`${process.cwd()}/packages/moss-tts/package.json`);
const audioReq = createRequire(`${process.cwd()}/packages/audio-codecs/package.json`);
const officeReq = createRequire(`${process.cwd()}/packages/office/package.json`);

function packageRoot(name, resolver = mossReq, fromDir = join(process.cwd(), "packages/moss-tts")) {
  return resolvePackageMetadata(name, resolver, fromDir, process.cwd());
}

const allowed = ["scripts/ensure-electron.mjs", "onnxruntime-node packaged CPU binaries"];
if (pkg.scripts && Object.keys(pkg.scripts).some((k) => k.includes("preinstall"))) {
  console.error("unexpected install script");
  process.exit(1);
}

const ort = packageRoot("onnxruntime-node");
if (
  ort.metadata.version !== "1.23.2" || ort.metadata.license !== "MIT" ||
  ort.metadata.scripts?.postinstall !== "node ./script/install"
) {
  console.error("onnxruntime-node supply-chain contract drift");
  process.exit(1);
}
const ortReq = createRequire(join(ort.root, "package.json"));
const admZip = packageRoot("adm-zip", ortReq, ort.root);
if (admZip.metadata.version !== "0.6.0" || admZip.metadata.license !== "MIT") {
  console.error("onnxruntime-node adm-zip security override drift");
  process.exit(1);
}
for (const [platform, arch] of [["darwin", "arm64"], ["darwin", "x64"], ["win32", "x64"]]) {
  const targetRoot = join(ort.root, "bin", "napi-v6", platform, arch);
  if (!existsSync(join(targetRoot, "onnxruntime_binding.node"))) {
    console.error("onnxruntime-node packaged CPU target missing", `${platform}-${arch}`);
    process.exit(1);
  }
}
const sentencepiece = packageRoot("sentencepiece-js");
const sentencepieceEntry = readFileSync(join(sentencepiece.root, "dist/index.js"), "utf8");
if (
  sentencepiece.metadata.version !== "1.1.0" ||
  sentencepiece.metadata.license !== "Apache-2.0" ||
  !sentencepieceEntry.includes("data:application/octet-stream;base64,AGFzb")
) {
  console.error("sentencepiece-js pinned embedded WASM closure missing");
  process.exit(1);
}
const silk = packageRoot("silk-wasm", audioReq, join(process.cwd(), "packages/audio-codecs"));
const silkBinary = join(silk.root, "lib", "silk.wasm");
if (
  silk.metadata.version !== "3.7.1" || silk.metadata.license !== "MIT" ||
  silk.metadata.scripts?.postinstall || !existsSync(silkBinary) ||
  readFileSync(silkBinary).subarray(0, 4).toString("hex") !== "0061736d"
) {
  console.error("silk-wasm pinned WASM closure drift");
  process.exit(1);
}
const opus = packageRoot("libopus-wasm", audioReq, join(process.cwd(), "packages/audio-codecs"));
const opusGenerated = join(opus.root, "dist/generated/libopus.generated.mjs");
if (
  opus.metadata.version !== "0.2.0" || opus.metadata.license !== "MIT" ||
  opus.metadata.scripts?.postinstall || !existsSync(opusGenerated) ||
  !readFileSync(opusGenerated).includes(Buffer.from([0x00, 0x61, 0x73, 0x6d]))
) {
  console.error("libopus-wasm pinned embedded WASM closure drift");
  process.exit(1);
}
const pptfast = packageRoot("@liustack/pptfast", officeReq, join(process.cwd(), "packages/office"));
const pptfastReq = createRequire(join(pptfast.root, "package.json"));
const pptxgenjs = packageRoot("pptxgenjs", pptfastReq, pptfast.root);
const pptxgenReq = createRequire(join(pptxgenjs.root, "package.json"));
const imageSize = packageRoot("image-size", pptxgenReq, pptxgenjs.root);
const sharp = packageRoot("sharp", pptfastReq, pptfast.root);
const exceljs = packageRoot("exceljs", officeReq, join(process.cwd(), "packages/office"));
const excelReq = createRequire(join(exceljs.root, "package.json"));
const uuid = packageRoot("uuid", excelReq, exceljs.root);
const lock = readFileSync("pnpm-lock.yaml", "utf8");
if (
  pkg.pnpm?.overrides?.["pptxgenjs>image-size"] !== "workspace:*" ||
  pkg.pnpm?.overrides?.["@liustack/pptfast>sharp"] !== "0.35.3" ||
  pkg.pnpm?.overrides?.["exceljs>uuid"] !== "11.1.1" ||
  imageSize.metadata.version !== "0.5.7" ||
  imageSize.metadata.license !== "MIT" ||
  sharp.metadata.version !== "0.35.3" ||
  uuid.metadata.version !== "11.1.1" ||
  uuid.metadata.license !== "MIT" ||
  !lock.includes("image-size: link:packages/image-size-disabled") ||
  !lock.includes("sharp@0.35.3:") ||
  !lock.includes("uuid@11.1.1:") ||
  /(?:^|\n)\s{2}image-size@1\.2\.1:/.test(lock) ||
  /(?:^|\n)\s{2}sharp@0\.34\.5:/.test(lock) ||
  /(?:^|\n)\s{2}uuid@8\.3\.2:/.test(lock)
) {
  console.error("Office transitive security closure drift");
  process.exit(1);
}
console.log("audit:dependencies ok allowlist", allowed.join(","));
