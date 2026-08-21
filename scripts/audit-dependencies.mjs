import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const npmrc = readFileSync(".npmrc", "utf8");
if (!/^ignore-scripts=true$/m.test(npmrc)) {
  console.error("install scripts must stay disabled");
  process.exit(1);
}
const mossReq = createRequire(`${process.cwd()}/packages/moss-tts/package.json`);
const audioReq = createRequire(`${process.cwd()}/packages/audio-codecs/package.json`);

function packageRoot(name, resolver = mossReq, fromDir = join(process.cwd(), "packages/moss-tts")) {
  const linked = join(fromDir, "node_modules", ...name.split("/"));
  if (existsSync(join(linked, "package.json"))) {
    const root = dirname(realpathSync(join(linked, "package.json")));
    return { root, metadata: JSON.parse(readFileSync(join(root, "package.json"), "utf8")) };
  }
  let cursor = dirname(resolver.resolve(name));
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = join(cursor, "package.json");
    if (existsSync(candidate)) {
      const metadata = JSON.parse(readFileSync(candidate, "utf8"));
      if (metadata.name === name) return { root: cursor, metadata };
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(`cannot resolve ${name}`);
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
console.log("audit:dependencies ok allowlist", allowed.join(","));
