import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { ROOT } from "./lib/repo.mjs";
import { resolvePackageMetadata } from "./lib/package-metadata.mjs";
import { PRODUCT_VERSION } from "./lib/product.mjs";
import {
  MNEMON_UPSTREAM,
  mnemonAssetForPluginTarget,
} from "../packages/release-identity/src/mnemon-assets.js";
import {
  FIRST_PARTY_PLUGIN_METADATA,
  PLUGIN_CATALOG_SCHEMA,
} from "../packages/runtime/src/plugin-catalog.ts";

const dest = join(ROOT, "dist/runtime-staging/plugins");
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
const targetArg = process.argv.includes("--target")
  ? process.argv[process.argv.indexOf("--target") + 1]
  : process.env.PENGLAI_PACK_TARGET;
const ALLOWED_TARGETS = new Set(["darwin-arm64", "darwin-x64", "win32-x64"]);
if (targetArg && !ALLOWED_TARGETS.has(targetArg)) {
  console.error(
    "pack-plugins --target must be darwin-arm64, darwin-x64, or win32-x64",
  );
  process.exit(1);
}
const localTarget =
  process.platform === "darwin"
    ? `darwin-${process.arch}`
    : process.platform === "win32"
      ? `win32-${process.arch}`
      : null;
const effectiveTarget =
  targetArg ??
  (localTarget && ALLOWED_TARGETS.has(localTarget) ? localTarget : null);
mkdirSync(dest, { recursive: true });
mkdirSync(join(ROOT, "evidence/generated"), { recursive: true });

const FORBIDDEN = ["@penglai/credentials-keychain", "@penglai/plugin-smoke"];

const packs = [
  {
    id: "@penglai/plugin-center",
    dir: "packages/plugin-center",
    file: `penglai-plugin-center-${PRODUCT_VERSION}.tgz`,
    host: "src/index.ts",
    client: "src/dsh-client.js",
    dshClient: {
      inject: [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-settings-general",
      ],
      platform: "web",
    },
  },
  {
    id: "@penglai/im",
    dir: "packages/im",
    file: `penglai-im-${PRODUCT_VERSION}.tgz`,
    host: "src/index.ts",
    client: "src/dsh-client.js",
    dshClient: {
      inject: [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-settings-general",
      ],
      platform: "web",
    },
  },
  {
    id: "@penglai/plugin-reference",
    dir: "packages/plugin-reference",
    file: `penglai-plugin-reference-${PRODUCT_VERSION}.tgz`,
    host: "src/index.ts",
    client: null,
    version: PRODUCT_VERSION,
  },
  {
    id: "@penglai/asr",
    dir: "packages/asr",
    file: `penglai-asr-${PRODUCT_VERSION}.tgz`,
    host: "src/index.ts",
    client: "src/dsh-client.js",
    dshClient: {
      inject: [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings",
      ],
      platform: "web",
    },
  },
  {
    id: "@penglai/moss-tts",
    dir: "packages/moss-tts",
    file: `penglai-moss-tts-${PRODUCT_VERSION}.tgz`,
    host: "src/index.ts",
    client: "src/dsh-client.js",
    dshClient: {
      inject: [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings",
      ],
      platform: "web",
    },
  },
  {
    id: "@penglai/memory",
    dir: "packages/memory",
    file: `penglai-memory-${PRODUCT_VERSION}.tgz`,
    host: "src/index.ts",
    client: "src/dsh-client.js",
    dshClient: {
      inject: [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings",
      ],
      platform: "web",
    },
  },
  {
    id: "@penglai/office",
    dir: "packages/office",
    file: `penglai-office-${PRODUCT_VERSION}.tgz`,
    host: "src/index.ts",
    client: "src/dsh-client.js",
    dshClient: {
      inject: [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings",
      ],
      platform: "web",
    },
  },
  {
    id: "@penglai/budget",
    dir: "packages/budget",
    file: `penglai-budget-${PRODUCT_VERSION}.tgz`,
    host: "src/index.ts",
    client: "src/dsh-client.js",
    dshClient: {
      inject: [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings",
      ],
      platform: "web",
    },
  },
  {
    id: "@penglai/companion",
    dir: "packages/companion",
    file: `penglai-companion-${PRODUCT_VERSION}.tgz`,
    host: "src/index.ts",
    client: "src/dsh-client.js",
    dshClient: {
      inject: [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings",
      ],
      platform: "web",
    },
  },
];

for (const p of packs) {
  if (FORBIDDEN.includes(p.id) && !p.rollbackFixture) {
    console.error("refusing to pack historical package", p.id);
    process.exit(1);
  }
}

if (
  packs.length !== FIRST_PARTY_PLUGIN_METADATA.length ||
  packs.some(
    (pack) =>
      !FIRST_PARTY_PLUGIN_METADATA.some((entry) => entry.id === pack.id),
  )
) {
  console.error("pack list and trusted first-party catalog metadata diverged");
  process.exit(1);
}

function sha256(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

const ARCHIVE_EPOCH = new Date("2000-01-01T00:00:00.000Z");

function normalizedArchiveFiles(root, dir = root, files = []) {
  for (const name of readdirSync(dir).sort()) {
    const absolute = join(dir, name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      console.error("plugin archive stage must not contain symlinks", absolute);
      process.exit(1);
    }
    if (stat.isDirectory()) {
      normalizedArchiveFiles(root, absolute, files);
      continue;
    }
    if (!stat.isFile()) {
      console.error(
        "plugin archive stage contains a non-regular entry",
        absolute,
      );
      process.exit(1);
    }
    const archivePath = relative(root, absolute).split(sep).join("/");
    if (
      !archivePath ||
      archivePath.includes("\n") ||
      Buffer.byteLength(archivePath) > 100
    ) {
      console.error("plugin ustar path is unsafe or too long", archivePath);
      process.exit(1);
    }
    chmodSync(absolute, stat.mode & 0o111 ? 0o755 : 0o644);
    utimesSync(absolute, ARCHIVE_EPOCH, ARCHIVE_EPOCH);
    files.push(archivePath);
  }
  return files;
}

function writeDeterministicTgz(stage, tgz) {
  const files = normalizedArchiveFiles(stage);
  const listPath = `${tgz}.files`;
  const tarPath = `${tgz}.tar`;
  writeFileSync(listPath, `${files.join("\n")}\n`);
  try {
    execFileSync(
      "tar",
      [
        "-cf",
        tarPath,
        "--format",
        "ustar",
        "--uid",
        "0",
        "--gid",
        "0",
        "--uname",
        "root",
        "--gname",
        "root",
        "--no-acls",
        "--no-xattrs",
        "--no-fflags",
        "--no-mac-metadata",
        "-C",
        stage,
        "-T",
        listPath,
      ],
      { cwd: ROOT },
    );
    writeFileSync(tgz, gzipSync(readFileSync(tarPath), { level: 9 }));
  } finally {
    rmSync(listPath, { force: true });
    rmSync(tarPath, { force: true });
  }
}

const PINNED_LARK_SDK = "1.73.0";
const LARK_SDK = "@larksuiteoapi/node-sdk";
const PINNED_QRCODE = "1.5.4";
const QRCODE = "qrcode";
const PINNED_SHERPA_ONNX = "1.13.5";
const SHERPA_ONNX = "sherpa-onnx";
const PINNED_ONNX_RUNTIME_NODE = "1.23.2";
const ONNX_RUNTIME_NODE = "onnxruntime-node";
const PINNED_SENTENCEPIECE_JS = "1.1.0";
const SENTENCEPIECE_JS = "sentencepiece-js";
const PINNED_SILK_WASM = "3.7.1";
const SILK_WASM = "silk-wasm";
const PINNED_LIBOPUS_WASM = "0.2.0";
const LIBOPUS_WASM = "libopus-wasm";
const PINNED_PPTFAST = "0.20.0";
const PPTFAST = "@liustack/pptfast";
const BAILEYS = "@whiskeysockets/baileys";
const LIBSIGNAL = "libsignal";
const AXIOS = "axios";
const FORM_DATA = "form-data";
const AWS_S3_CLIENT = "@aws-sdk/client-s3";

function resolvePackageRoot(fromDir, name) {
  const req = createRequire(join(fromDir, "package.json"));
  return resolvePackageMetadata(name, req, fromDir, ROOT).root;
}

function vendorNpmPackage(fromDir, name, destNm, seen, filters = new Map()) {
  if (name.startsWith("@types/") || name === "undici-types") return;
  if (seen.has(name)) return;
  seen.add(name);
  const pkgRoot = resolvePackageRoot(fromDir, name);
  const dest = join(destNm, ...name.split("/"));
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(pkgRoot, dest, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      if (src === pkgRoot) return true;
      if (relative(pkgRoot, src).split(/[\\/]/).includes("node_modules"))
        return false;
      if (src.endsWith(".map")) return false;
      const filter = filters.get(name);
      return filter ? filter(pkgRoot, src) : true;
    },
  });
  const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    vendorNpmPackage(pkgRoot, dep, destNm, seen, filters);
  }
}

function reportUnexecutableDynamicRequire(pluginId, hostJs, metafile) {
  const specs = [...hostJs.matchAll(/Dynamic require of ["']([^"']+)["']/g)].map((row) => row[1]);
  const formData = hostJs.includes("form-data/lib/form_data");
  if (specs.length === 0 && !formData) return false;
  const chain = [];
  for (const [file, info] of Object.entries(metafile?.inputs ?? {})) {
    const imports = (info.imports ?? []).map((row) => String(row.path ?? row.original ?? ""));
    const hit =
      specs.some((spec) => file.includes(spec) || imports.some((imp) => imp.includes(spec))) ||
      (formData && (file.includes("form-data") || imports.some((imp) => imp.includes("form-data"))));
    if (hit) chain.push(file.replace(/\\/g, "/"));
  }
  console.error(pluginId, "host bundle has unexecutable dynamic require", {
    specs,
    formData,
    importChain: chain.slice(0, 24),
  });
  return true;
}

function vendorLarkSdk(stage) {
  const fromDir = join(ROOT, "packages/channel-feishu");
  const destNm = join(stage, "node_modules");
  vendorNpmPackage(fromDir, LARK_SDK, destNm, new Set());
  const vendored = JSON.parse(
    readFileSync(join(destNm, LARK_SDK, "package.json"), "utf8"),
  );
  if (vendored.version !== PINNED_LARK_SDK) {
    console.error(
      "vendored Lark SDK is",
      vendored.version,
      "expected",
      PINNED_LARK_SDK,
    );
    process.exit(1);
  }
}

function vendorQrcode(stage) {
  const fromDir = join(ROOT, "packages/channel-weixin");
  const destNm = join(stage, "node_modules");
  // yargs is CLI-only; toDataURL needs pngjs + dijkstrajs. Skipping yargs keeps
  // find-up owner-path docs out of the production tarball scanner.
  const seen = new Set(["yargs"]);
  vendorNpmPackage(
    fromDir,
    QRCODE,
    destNm,
    seen,
    new Map([
      [
        QRCODE,
        (pkgRoot, src) => {
          const rel = relative(pkgRoot, src).split(/[\\/]/);
          return !(
            rel[0] === "bin" ||
            rel[0] === "build" ||
            rel[0] === "helper"
          );
        },
      ],
    ]),
  );
  const vendored = JSON.parse(
    readFileSync(join(destNm, QRCODE, "package.json"), "utf8"),
  );
  if (vendored.version !== PINNED_QRCODE) {
    console.error(
      "vendored qrcode is",
      vendored.version,
      "expected",
      PINNED_QRCODE,
    );
    process.exit(1);
  }
  if (
    existsSync(join(destNm, "yargs")) ||
    existsSync(join(destNm, "find-up"))
  ) {
    console.error("vendored qrcode must not pull CLI deps yargs/find-up");
    process.exit(1);
  }
  if (
    !existsSync(join(destNm, "pngjs", "package.json")) ||
    !existsSync(join(destNm, "dijkstrajs", "package.json"))
  ) {
    console.error("vendored qrcode missing pngjs/dijkstrajs");
    process.exit(1);
  }
}

async function vendorPptfast(stage) {
  const fromDir = join(ROOT, "packages/office");
  const destNm = join(stage, "node_modules");
  const pkgRoot = resolvePackageRoot(fromDir, PPTFAST);
  const packageDest = join(destNm, ...PPTFAST.split("/"));
  mkdirSync(join(packageDest, "dist"), { recursive: true });
  cpSync(join(pkgRoot, "package.json"), join(packageDest, "package.json"));
  cpSync(join(pkgRoot, "LICENSE"), join(packageDest, "LICENSE"));
  const vendored = JSON.parse(readFileSync(join(packageDest, "package.json"), "utf8"));
  if (vendored.version !== PINNED_PPTFAST) {
    console.error("vendored pptfast is", vendored.version, "expected", PINNED_PPTFAST);
    process.exit(1);
  }
  const disabledImageModule = {
    name: "penglai-office-no-images",
    setup(context) {
      context.onResolve({ filter: /^(image-size|sharp)$/ }, (args) => ({
        path: args.path,
        namespace: "penglai-office-disabled-image",
      }));
      context.onLoad({ filter: /.*/, namespace: "penglai-office-disabled-image" }, () => ({
        contents: `export default function disabledImageDependency() { throw new Error("Penglai Office 0.5.7 accepts text-only PPTX creation"); }\nexport const imageSize = disabledImageDependency;`,
        loader: "js",
      }));
    },
  };
  const pptfastBundle = await build({
    absWorkingDir: ROOT,
    stdin: {
      contents: [
        `import { generatePptx } from ${JSON.stringify(join(pkgRoot, "dist/index.js"))};`,
        `import { installNodePlatform } from ${JSON.stringify(join(pkgRoot, "dist/node.js"))};`,
        "export { generatePptx, installNodePlatform };",
      ].join("\n"),
      resolveDir: ROOT,
      sourcefile: "penglai-pptfast-runtime.mjs",
      loader: "js",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: join(packageDest, "dist/penglai-runtime.cjs"),
    plugins: [disabledImageModule],
    metafile: true,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
  });
  const bundledPackages = new Map();
  for (const input of Object.keys(pptfastBundle.metafile.inputs)) {
    const absolute = isAbsolute(input) ? input : join(ROOT, input);
    if (!absolute.includes(`${sep}node_modules${sep}`)) continue;
    let cursor = dirname(absolute);
    for (let depth = 0; depth < 14; depth += 1) {
      const packageJson = join(cursor, "package.json");
      if (existsSync(packageJson)) {
        const metadata = JSON.parse(readFileSync(packageJson, "utf8"));
        if (typeof metadata.name === "string" && typeof metadata.version === "string") {
          bundledPackages.set(`${metadata.name}@${metadata.version}:${cursor}`, { cursor, metadata });
          break;
        }
      }
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  const licenseRows = [];
  for (const { cursor, metadata } of [...bundledPackages.values()].sort((a, b) =>
    `${a.metadata.name}@${a.metadata.version}`.localeCompare(`${b.metadata.name}@${b.metadata.version}`)
  )) {
    let licenseFiles = readdirSync(cursor)
      .filter((file) => /^(licen[cs]e|notice)([-.].*)?$/i.test(file))
      .sort();
    if (licenseFiles.length === 0) {
      licenseFiles = readdirSync(cursor)
        .filter((file) => /^readme(?:\..*)?$/i.test(file))
        .filter((file) => {
          const readme = readFileSync(join(cursor, file), "utf8");
          return (
            /^#{1,6}\s+licen[cs]e\s*$/im.test(readme) &&
            (/Permission is hereby granted/i.test(readme) ||
              /Apache License\s+Version 2\.0/i.test(readme) ||
              /Redistribution and use in source and binary forms/i.test(readme))
          );
        })
        .sort();
    }
    if (licenseFiles.length === 0) {
      console.error("bundled pptfast dependency has no license text", metadata.name, metadata.version);
      process.exit(1);
    }
    const safePackage = `${metadata.name}@${metadata.version}`.replace(/[^A-Za-z0-9._-]/g, "_");
    const licenseDest = join(packageDest, "third_party", safePackage);
    mkdirSync(licenseDest, { recursive: true });
    const files = licenseFiles.map((file) => {
      const source = join(cursor, file);
      cpSync(source, join(licenseDest, file));
      return { file, sha256: sha256(source) };
    });
    licenseRows.push({
      name: metadata.name,
      version: metadata.version,
      license: metadata.license ?? "SEE-LICENSE-FILES",
      files,
    });
  }
  writeFileSync(
    join(packageDest, "third_party", "licenses.json"),
    JSON.stringify(licenseRows, null, 2),
  );
  const runtime = readFileSync(join(packageDest, "dist/penglai-runtime.cjs"), "utf8");
  if (
    runtime.includes("/Users/") ||
    runtime.includes("/Volumes/") ||
    runtime.includes("C:\\Users\\") ||
    runtime.includes('require("image-size")') ||
    runtime.includes('require("sharp")')
  ) {
    console.error("Penglai Office pptfast runtime contains a host path or disabled dependency");
    process.exit(1);
  }
}

async function vendorAudioCodecs(stage) {
  const fromDir = join(ROOT, "packages/audio-codecs");
  const destNm = join(stage, "node_modules");
  vendorNpmPackage(fromDir, SILK_WASM, destNm, new Set());
  vendorNpmPackage(fromDir, LIBOPUS_WASM, destNm, new Set());
  const silkRoot = join(destNm, SILK_WASM);
  const opusRoot = join(destNm, LIBOPUS_WASM);
  const silk = JSON.parse(readFileSync(join(silkRoot, "package.json"), "utf8"));
  const opus = JSON.parse(readFileSync(join(opusRoot, "package.json"), "utf8"));
  if (silk.version !== PINNED_SILK_WASM || silk.license !== "MIT") {
    console.error("vendored silk-wasm pin/license mismatch");
    process.exit(1);
  }
  if (opus.version !== PINNED_LIBOPUS_WASM || opus.license !== "MIT") {
    console.error("vendored libopus-wasm pin/license mismatch");
    process.exit(1);
  }
  const silkBinary = join(silkRoot, "lib", "silk.wasm");
  if (
    !existsSync(silkBinary) ||
    readFileSync(silkBinary).subarray(0, 4).toString("hex") !== "0061736d"
  ) {
    console.error("vendored silk-wasm binary missing or invalid");
    process.exit(1);
  }
  const opusGenerated = join(
    opusRoot,
    "dist",
    "generated",
    "libopus.generated.mjs",
  );
  let opusBytes = readFileSync(opusGenerated);
  if (!opusBytes.includes(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) {
    console.error("vendored libopus-wasm embedded binary missing");
    process.exit(1);
  }
  for (const [path, expected] of [
    [
      join(silkRoot, "LICENSE"),
      "3b1585c0e6d9d501e86383948fc0d1734bcb86517a13111d97749c65ad2bfb74",
    ],
    [
      join(opusRoot, "LICENSE"),
      "6ae2daf92d73e912aef033d56ce374df997ae0ad1d88ca9ef76f0c11123aae27",
    ],
    [
      join(opusRoot, "THIRD_PARTY_NOTICES.md"),
      "e1aa9531a6cd740a76f54a06903d76dbec8b218307030c8444f2570932fafec8",
    ],
  ]) {
    if (!existsSync(path) || sha256(path) !== expected) {
      console.error("audio codec license hash mismatch", path);
      process.exit(1);
    }
  }
  // Construct the upstream build prefix from segments so the public source
  // tree does not itself retain a concrete developer home path. The exact
  // bytes are still required to scrub the pinned upstream module.
  const upstreamOwnerPrefix = Buffer.from(
    [
      "",
      "Users",
      "steipete",
      "Projects",
      "libopus-wasm",
      ".cache",
      "opus-1.6.1",
      "",
    ].join("/"),
  );
  const macosHomePrefix = Buffer.from(["", "Users", ""].join("/"));
  const alreadyScrubbedHash =
    "ded4c50a60e4848919d093890563b623404bb9a1bf9e039845603f1ecb282fa5";
  const upstreamHash =
    "7f254556d782ac20a304068d4ecf7a1b9e6e94df5694f550e6d14c217d7e2028";
  const currentHash = sha256(opusGenerated);
  const work = Buffer.from(opusBytes);
  if (currentHash === upstreamHash) {
    const neutralPrefix = Buffer.alloc(upstreamOwnerPrefix.length, 0x5f);
    Buffer.from("third_party/libopus-1.6.1/").copy(neutralPrefix);
    let cursor = 0;
    while ((cursor = work.indexOf(upstreamOwnerPrefix, cursor)) >= 0) {
      neutralPrefix.copy(work, cursor);
      cursor += neutralPrefix.length;
    }
  } else if (currentHash !== alreadyScrubbedHash) {
    console.error("libopus-wasm generated module hash drift", currentHash);
    process.exit(1);
  }
  const scrubDir = join(ROOT, "dist", "libopus-scrub");
  mkdirSync(scrubDir, { recursive: true });
  const scrubbedPath = join(scrubDir, "libopus.generated.mjs");
  writeFileSync(scrubbedPath, work);
  if (
    sha256(scrubbedPath) !== alreadyScrubbedHash ||
    work.includes(macosHomePrefix) ||
    work.includes(Buffer.from("/home/"))
  ) {
    console.error("libopus-wasm deterministic owner-path scrub failed");
    process.exit(1);
  }
  writeFileSync(opusGenerated, work);
  const loaded = await import(
    `${pathToFileURL(join(opusRoot, "dist", "index.js")).href}?packed=1`
  );
  const runtime = await loaded.loadLibopus();
  if (runtime.version !== "libopus 1.6.1") {
    console.error(
      "vendored libopus-wasm runtime version mismatch",
      runtime.version,
    );
    process.exit(1);
  }
  const encoder = await loaded.createEncoder({
    sampleRate: 16_000,
    channels: 1,
    frameSize: 320,
  });
  try {
    const packet = encoder.encode(new Int16Array(320));
    if (!(packet instanceof Uint8Array) || packet.length === 0) {
      console.error("vendored libopus-wasm encode smoke failed");
      process.exit(1);
    }
  } finally {
    encoder.free();
  }
}

function vendorSherpaOnnx(stage) {
  const fromDir = join(ROOT, "packages/asr");
  const destNm = join(stage, "node_modules");
  vendorNpmPackage(fromDir, SHERPA_ONNX, destNm, new Set());
  const root = join(destNm, SHERPA_ONNX);
  const vendored = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (vendored.version !== PINNED_SHERPA_ONNX) {
    console.error(
      "vendored sherpa-onnx is",
      vendored.version,
      "expected",
      PINNED_SHERPA_ONNX,
    );
    process.exit(1);
  }
  const wasm = join(root, "sherpa-onnx-wasm-nodejs.wasm");
  if (
    !existsSync(wasm) ||
    readFileSync(wasm).subarray(0, 4).toString("hex") !== "0061736d"
  ) {
    console.error("vendored sherpa-onnx WASM missing or invalid");
    process.exit(1);
  }
  const notices = join(ROOT, "packages/asr/third_party");
  if (!existsSync(notices)) {
    console.error("ASR third-party license notices missing");
    process.exit(1);
  }
  cpSync(notices, join(stage, "third_party"), {
    recursive: true,
    dereference: false,
  });
  const expectedLicenses = new Map([
    [
      "FunASR-MODEL_LICENSE-1.1.txt",
      "7dba975a2069691db4992b0592d70828b330d2f8a30a71450f4e152a554e84f8",
    ],
    [
      "sherpa-onnx-Apache-2.0.txt",
      "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    ],
  ]);
  for (const [file, expected] of expectedLicenses) {
    const actual = sha256(join(stage, "third_party", file));
    if (actual !== expected) {
      console.error("ASR third-party license hash mismatch", file, actual);
      process.exit(1);
    }
  }
}

function ortTargetParts(target) {
  if (target === "darwin-arm64") return ["darwin", "arm64"];
  if (target === "darwin-x64") return ["darwin", "x64"];
  if (target === "win32-x64") return ["win32", "x64"];
  return null;
}

function assertTargetBinary(path, target) {
  const bytes = readFileSync(path);
  if (target === "darwin-arm64" || target === "darwin-x64") {
    const expectedCpu = target === "darwin-arm64" ? 0x0100000c : 0x01000007;
    if (
      bytes.length < 8 ||
      bytes.readUInt32LE(0) !== 0xfeedfacf ||
      bytes.readUInt32LE(4) !== expectedCpu
    ) {
      console.error("MOSS ORT Mach-O target mismatch", target, path);
      process.exit(1);
    }
    return;
  }
  if (target === "win32-x64") {
    const peOffset = bytes.length >= 0x40 ? bytes.readUInt32LE(0x3c) : -1;
    if (
      bytes.length < peOffset + 6 ||
      bytes.subarray(0, 2).toString("ascii") !== "MZ" ||
      bytes.subarray(peOffset, peOffset + 4).toString("ascii") !== "PE\0\0" ||
      bytes.readUInt16LE(peOffset + 4) !== 0x8664
    ) {
      console.error("MOSS ORT PE target mismatch", target, path);
      process.exit(1);
    }
  }
}

function vendorMossRuntime(stage) {
  if (!effectiveTarget) {
    console.error(
      "MOSS plugin packaging requires --target on non-macOS/non-Windows builders",
    );
    process.exit(1);
  }
  const targetParts = ortTargetParts(effectiveTarget);
  const fromDir = join(ROOT, "packages/moss-tts");
  const destNm = join(stage, "node_modules");
  const filters = new Map([
    [
      ONNX_RUNTIME_NODE,
      (root, src) => {
        const parts = relative(root, src).split(sep);
        if (parts[0] !== "bin" || parts[1] !== "napi-v6") return true;
        if (parts.length <= 2) return true;
        if (parts[2] !== targetParts[0]) return false;
        return parts.length === 3 || parts[3] === targetParts[1];
      },
    ],
  ]);
  vendorNpmPackage(fromDir, ONNX_RUNTIME_NODE, destNm, new Set(), filters);
  vendorNpmPackage(fromDir, SENTENCEPIECE_JS, destNm, new Set(), filters);

  const ortRoot = join(destNm, ONNX_RUNTIME_NODE);
  const sentencepieceRoot = join(destNm, SENTENCEPIECE_JS);
  const ortPackage = JSON.parse(
    readFileSync(join(ortRoot, "package.json"), "utf8"),
  );
  const sentencepiecePackage = JSON.parse(
    readFileSync(join(sentencepieceRoot, "package.json"), "utf8"),
  );
  if (
    ortPackage.version !== PINNED_ONNX_RUNTIME_NODE ||
    ortPackage.license !== "MIT"
  ) {
    console.error("vendored onnxruntime-node pin/license mismatch");
    process.exit(1);
  }
  if (
    sentencepiecePackage.version !== PINNED_SENTENCEPIECE_JS ||
    sentencepiecePackage.license !== "Apache-2.0"
  ) {
    console.error("vendored sentencepiece-js pin/license mismatch");
    process.exit(1);
  }
  const targetRoot = join(ortRoot, "bin", "napi-v6", ...targetParts);
  const binding = join(targetRoot, "onnxruntime_binding.node");
  if (!existsSync(binding)) {
    console.error("onnxruntime-node has no binary for target", effectiveTarget);
    process.exit(1);
  }
  assertTargetBinary(binding, effectiveTarget);
  const binRoot = join(ortRoot, "bin", "napi-v6");
  const unexpected = [];
  for (const platform of ["darwin", "linux", "win32"]) {
    for (const arch of ["arm64", "x64"]) {
      if (platform === targetParts[0] && arch === targetParts[1]) continue;
      if (existsSync(join(binRoot, platform, arch)))
        unexpected.push(`${platform}-${arch}`);
    }
  }
  if (unexpected.length) {
    console.error("MOSS ORT closure contains non-target binaries", unexpected);
    process.exit(1);
  }

  const runtimeSource = join(
    ROOT,
    "packages/moss-tts/src/third_party/moss_tts",
  );
  const runtimeDest = join(stage, "dist/third_party/moss_tts");
  mkdirSync(runtimeDest, { recursive: true });
  cpSync(join(runtimeSource, "runtime.mjs"), join(runtimeDest, "runtime.mjs"));
  cpSync(join(runtimeSource, "LICENSE"), join(runtimeDest, "LICENSE"));
  if (
    sha256(join(runtimeDest, "runtime.mjs")) !==
    "b49d214bbe9ba9849d48e1588c66a70173eee76c211bb4f473b5eadf7bce038c"
  ) {
    console.error("modified MOSS Node runtime hash mismatch");
    process.exit(1);
  }
  const notices = join(ROOT, "packages/moss-tts/third_party");
  cpSync(notices, join(stage, "third_party"), {
    recursive: true,
    dereference: false,
  });
  const expectedLicenses = new Map([
    [
      "OpenMOSS-Apache-2.0.txt",
      "e83b87b4c86fc39a3e3278705e02f3599d63b0a9fd006a6ec7aa721d38d4086d",
    ],
    [
      "onnxruntime-MIT.txt",
      "2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c",
    ],
    [
      "sentencepiece-js-Apache-2.0.txt",
      "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
    ],
  ]);
  for (const [file, expected] of expectedLicenses) {
    const actual = sha256(join(stage, "third_party", file));
    if (actual !== expected) {
      console.error("MOSS third-party license hash mismatch", file, actual);
      process.exit(1);
    }
  }
}

const entries = [];
for (const p of packs) {
  const catalogMetadata = FIRST_PARTY_PLUGIN_METADATA.find(
    (entry) => entry.id === p.id,
  );
  if (!catalogMetadata || !effectiveTarget) {
    console.error("missing trusted catalog metadata/target", p.id);
    process.exit(1);
  }
  const stage = join(
    ROOT,
    "dist/plugin-pack",
    p.id.replace("@", "").replace("/", "-"),
  );
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, "dist"), { recursive: true });
  const vendorLark = p.id === "@penglai/im";
  const vendorQr = p.id === "@penglai/im";
  const vendorAudio = p.id === "@penglai/im";
  const vendorSherpa = p.id === "@penglai/asr";
  const vendorMoss = p.id === "@penglai/moss-tts";
  const vendorOfficePptfast = p.id === "@penglai/office";
  const disableOfficeCloudZip = p.id === "@penglai/office";
  const disabledOfficeCloudZipModule = {
    name: "penglai-office-no-cloud-zip",
    setup(context) {
      context.onResolve({ filter: /^@aws-sdk\/client-s3$/ }, (args) => ({
        path: args.path,
        namespace: "penglai-office-disabled-cloud-zip",
      }));
      context.onLoad({ filter: /.*/, namespace: "penglai-office-disabled-cloud-zip" }, () => ({
        contents: `class DisabledCloudArchive { constructor() { throw new Error("Penglai Office reads local archives only; S3 ZIP access is unavailable"); } }\nexport { DisabledCloudArchive as GetObjectCommand, DisabledCloudArchive as HeadObjectCommand };`,
        loader: "js",
      }));
    },
  };
  const built = await build({
    absWorkingDir: ROOT,
    entryPoints: [join(ROOT, p.dir, p.host)],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: join(stage, "dist/index.js"),
    external: [
      "@deepseek-ai/*",
      "electron",
      "node:sqlite",
      "node:crypto",
      "node:fs",
      "node:path",
      "node:child_process",
      ...(vendorLark ? [LARK_SDK] : []),
      ...(vendorQr ? [QRCODE] : []),
      ...(vendorAudio ? [SILK_WASM, LIBOPUS_WASM] : []),
      ...(vendorLark ? [AXIOS, FORM_DATA] : []),
      ...(vendorSherpa ? [SHERPA_ONNX] : []),
      ...(vendorMoss ? [ONNX_RUNTIME_NODE, SENTENCEPIECE_JS] : []),
      ...(vendorOfficePptfast ? [PPTFAST] : []),
    ],
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
    metafile: true,
    banner: {
      js: 'import { createRequire as __penglaiCreateRequire } from "node:module";\nconst require = __penglaiCreateRequire(import.meta.url);\n',
    },
    plugins: disableOfficeCloudZip ? [disabledOfficeCloudZipModule] : [],
  });
  const hostJs = readFileSync(join(stage, "dist/index.js"), "utf8");
  const metafile = built.metafile;
  if (
    hostJs.includes('from "../src/') ||
    hostJs.includes("from './src/") ||
    hostJs.includes('from "./src/')
  ) {
    console.error(p.id, "host bundle still imports src");
    process.exit(1);
  }
  if (
    /\/Users\/[A-Za-z0-9._-]+\/|\/Volumes\/[^/\s]+\/|C:\\\\Users\\\\[A-Za-z0-9._-]+\\\\|\/\/[#@] sourceMappingURL=|\/var\/folders\/|\\\\Temp\\\\|sk-penglai-fixture/.test(
      hostJs,
    )
  ) {
    console.error("production bundle forbidden dist/index.js:owner volume", p.id);
    process.exit(1);
  }
  if (!hostJs.includes("__penglaiCreateRequire")) {
    console.error(p.id, "host bundle missing Node createRequire banner");
    process.exit(1);
  }
  if (
    disableOfficeCloudZip &&
    new RegExp(`require\\(["']${AWS_S3_CLIENT.replace("/", "\\/")}["']\\)`).test(hostJs)
  ) {
    console.error(p.id, "must fail closed for unzipper's unused S3 helper without bundling the AWS SDK");
    process.exit(1);
  }
  if (reportUnexecutableDynamicRequire(p.id, hostJs, metafile)) process.exit(1);
  if (existsSync(join(stage, "src"))) {
    console.error(p.id, "staged package must not include src");
    process.exit(1);
  }
  if (vendorLark) {
    if (!hostJs.includes(LARK_SDK)) {
      console.error(p.id, "host bundle dropped the official Lark SDK import");
      process.exit(1);
    }
    if (reportUnexecutableDynamicRequire(p.id, hostJs, metafile)) process.exit(1);
    vendorLarkSdk(stage);
  }
  if (p.id === "@penglai/im" && (hostJs.includes(BAILEYS) || hostJs.includes(LIBSIGNAL))) {
    console.error(p.id, "must not bundle the WhatsApp community runtime in 0.5.7");
    process.exit(1);
  }
  if (vendorQr) {
    if (!hostJs.includes(QRCODE)) {
      console.error(p.id, "host bundle dropped the qrcode import");
      process.exit(1);
    }
    if (reportUnexecutableDynamicRequire(p.id, hostJs, metafile)) process.exit(1);
    vendorQrcode(stage);
  }
  if (vendorAudio) {
    if (!hostJs.includes(SILK_WASM) || !hostJs.includes(LIBOPUS_WASM)) {
      console.error(p.id, "host bundle dropped the audio codec imports");
      process.exit(1);
    }
    await vendorAudioCodecs(stage);
  }
  if (vendorSherpa) {
    if (!hostJs.includes(SHERPA_ONNX)) {
      console.error(p.id, "host bundle dropped the sherpa-onnx runtime import");
      process.exit(1);
    }
    vendorSherpaOnnx(stage);
  }
  if (vendorMoss) {
    if (
      !hostJs.includes(ONNX_RUNTIME_NODE) ||
      !hostJs.includes(SENTENCEPIECE_JS)
    ) {
      console.error(
        p.id,
        "host bundle dropped the MOSS native runtime imports",
      );
      process.exit(1);
    }
    vendorMossRuntime(stage);
  }
  if (vendorOfficePptfast) {
    if (!hostJs.includes(PPTFAST)) {
      console.error(p.id, "host bundle dropped the pptfast runtime import");
      process.exit(1);
    }
    await vendorPptfast(stage);
  }
  if (p.id === "@penglai/memory") {
    const asset = mnemonAssetForPluginTarget(effectiveTarget);
    if (!asset) {
      console.error("memory plugin missing mnemon pin for", effectiveTarget);
      process.exit(1);
    }
    const src = join(ROOT, "third_party", "mnemon", "bin", asset.target, asset.binaryFilename);
    if (!existsSync(src)) {
      console.error("mnemon binary missing; run pnpm fetch:mnemon-assets -- --target", asset.target);
      process.exit(1);
    }
    const destBin = join(stage, "resources", "mnemon", asset.binaryFilename);
    mkdirSync(dirname(destBin), { recursive: true });
    cpSync(src, destBin);
    const licenseSrc = join(
      ROOT,
      "packages/moss-tts/third_party/sentencepiece-js-Apache-2.0.txt",
    );
    if (!existsSync(licenseSrc) || sha256(licenseSrc) !== MNEMON_UPSTREAM.licenseSha256) {
      console.error("Mnemon Apache-2.0 license missing or hash mismatch");
      process.exit(1);
    }
    cpSync(licenseSrc, join(stage, "resources", "mnemon", "LICENSE"));
    if (asset.executable) chmodSync(destBin, 0o755);
    const got = sha256(destBin);
    if (got !== asset.binarySha256) {
      console.error("packed mnemon hash mismatch", got);
      process.exit(1);
    }
  }
  if (p.id === "@penglai/office") {
    const fontSrc = join(ROOT, "packages/office/fonts/NotoSansSC-VF.ttf");
    const fontNotice = join(ROOT, "packages/office/fonts/OFL.txt");
    if (!existsSync(fontSrc) || !existsSync(fontNotice)) {
      console.error("office CJK OFL font missing");
      process.exit(1);
    }
    const destFont = join(stage, "resources", "fonts", "NotoSansSC-VF.ttf");
    mkdirSync(dirname(destFont), { recursive: true });
    cpSync(fontSrc, destFont);
    cpSync(fontNotice, join(stage, "resources", "fonts", "OFL.txt"));
    cpSync(join(ROOT, "packages/office/fonts/NOTICE"), join(stage, "resources", "fonts", "NOTICE"));
    const fontHash = sha256(destFont);
    if (fontHash !== "d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964") {
      console.error("packed office CJK font hash mismatch", fontHash);
      process.exit(1);
    }
  }
  if (p.client) {
    const clientSrc = join(ROOT, p.dir, p.client);
    if (!existsSync(clientSrc)) {
      console.error("missing client", clientSrc);
      process.exit(1);
    }
    if (p.id === "@penglai/memory") {
      const sourcesClient = join(ROOT, "packages/context/src/dsh-client.js");
      if (!existsSync(sourcesClient)) {
        console.error("missing Penglai Memory sources client", sourcesClient);
        process.exit(1);
      }
      const combinedClient =
        `${readFileSync(sourcesClient, "utf8").trimEnd()}\n${readFileSync(clientSrc, "utf8").trimStart()}`;
      const moduleRegistrations = combinedClient.match(/__ModuleLoader__\.load/g)?.length ?? 0;
      if (
        moduleRegistrations !== 1 ||
        !combinedClient.includes("function createPenglaiMemorySourcesClient(require)") ||
        combinedClient.includes('id: "@penglai/memory-sources"') ||
        combinedClient.includes("penglaiMemorySourcesSettings") ||
        !combinedClient.includes('"sourcesStatus"') ||
        readFileSync(sourcesClient, "utf8").includes("remote.$mount") ||
        hostJs.includes("penglaiMemorySourcesSettings")
      ) {
        console.error("Penglai Memory client must register one DSH module and one Remote namespace");
        process.exit(1);
      }
      writeFileSync(
        join(stage, "dist/client.js"),
        combinedClient,
      );
    } else {
      cpSync(clientSrc, join(stage, "dist/client.js"));
    }
  }
  if (
    p.id === "@penglai/im" &&
    (existsSync(join(stage, "node_modules", ...BAILEYS.split("/"))) ||
      existsSync(join(stage, "node_modules", LIBSIGNAL)))
  ) {
    console.error(p.id, "staging contains the forbidden WhatsApp community runtime");
    process.exit(1);
  }
  const pkg = {
    name: p.id,
    version: p.version ?? PRODUCT_VERSION,
    type: "module",
    main: "dist/index.js",
    exports: {
      ".": "./dist/index.js",
      "./package.json": "./package.json",
      ...(p.client ? { "./client": "./dist/client.js" } : {}),
    },
    penglaiPlugin: {
      schema: 1,
      id: catalogMetadata.id,
      dshExact: catalogMetadata.dsh.exact,
      target: effectiveTarget,
      platforms: catalogMetadata.platforms,
      capabilities: catalogMetadata.capabilities,
      permissions: catalogMetadata.permissions,
      source: catalogMetadata.source,
      provenanceClass: catalogMetadata.provenanceClass,
      license: catalogMetadata.license,
      migration: catalogMetadata.migration,
      rollback: catalogMetadata.rollback,
    },
    ...(p.dshClient
      ? { dsh: { client: { ...p.dshClient, immediately: true } } }
      : {}),
    ...(vendorLark
      ? {
          dependencies: {
            [LARK_SDK]: PINNED_LARK_SDK,
            [QRCODE]: PINNED_QRCODE,
            [SILK_WASM]: PINNED_SILK_WASM,
            [LIBOPUS_WASM]: PINNED_LIBOPUS_WASM,
          },
        }
      : {}),
    ...(vendorSherpa
      ? { dependencies: { [SHERPA_ONNX]: PINNED_SHERPA_ONNX } }
      : {}),
    ...(vendorMoss
      ? {
          dependencies: {
            [ONNX_RUNTIME_NODE]: PINNED_ONNX_RUNTIME_NODE,
            [SENTENCEPIECE_JS]: PINNED_SENTENCEPIECE_JS,
          },
        }
      : {}),
    ...(vendorOfficePptfast
      ? { dependencies: { [PPTFAST]: PINNED_PPTFAST } }
      : {}),
  };
  writeFileSync(join(stage, "package.json"), JSON.stringify(pkg, null, 2));
  if (vendorOfficePptfast) {
    const packageRoot = join(stage, "node_modules", ...PPTFAST.split("/"));
    const requirePptfast = createRequire(join(stage, "package.json"));
    const loaded = requirePptfast(join(packageRoot, "dist/penglai-runtime.cjs"));
    loaded.installNodePlatform?.();
    const generated = Buffer.from(
      await loaded.generatePptx({
        filename: "packed-office-smoke.pptx",
        theme: { id: "consulting" },
        slides: [
          { type: "cover", heading: "Penglai Office", subheading: "0.5.7" },
          { type: "ending", heading: "Packed runtime" },
        ],
      }),
    );
    if (generated.length < 1_000 || generated.subarray(0, 2).toString("ascii") !== "PK") {
      console.error(p.id, "vendored pptfast failed its packed-runtime smoke");
      process.exit(1);
    }
  }
  if (vendorLark) {
    const sdkEntry = join(stage, "node_modules", LARK_SDK, "lib", "index.js");
    if (!existsSync(sdkEntry)) {
      console.error(p.id, "vendored Lark SDK entry missing");
      process.exit(1);
    }
    const loaded = await import(pathToFileURL(sdkEntry).href);
    if (
      typeof loaded.Client !== "function" ||
      typeof loaded.WSClient !== "function" ||
      typeof loaded.EventDispatcher !== "function"
    ) {
      console.error(
        p.id,
        "vendored Lark SDK missing Client/WSClient/EventDispatcher",
      );
      process.exit(1);
    }
  }
  const tgz = join(dest, p.file);
  writeDeterministicTgz(stage, tgz);
  const hash = sha256(tgz);
  const reproduction = `${tgz}.reproduction`;
  writeDeterministicTgz(stage, reproduction);
  const reproducedHash = sha256(reproduction);
  rmSync(reproduction, { force: true });
  if (reproducedHash !== hash) {
    console.error(
      "plugin archive is not byte-reproducible",
      p.id,
      hash,
      reproducedHash,
    );
    process.exit(1);
  }
  entries.push({
    ...catalogMetadata,
    sha256: hash,
    target: effectiveTarget,
    hasClient: Boolean(p.client),
  });
}

const scannerModule = join(ROOT, "packages/runtime/dist/scanner.js");
if (!existsSync(scannerModule)) {
  console.error("compiled runtime scanner missing; run pnpm build before pack:plugins");
  process.exit(1);
}
const { assertPackedArtifactClean } = await import(pathToFileURL(scannerModule).href);
for (const entry of entries) {
  assertPackedArtifactClean(join(dest, entry.packageFile));
}

const expectedArchives = entries.map((entry) => entry.packageFile).sort();
const packedArchives = readdirSync(dest)
  .filter((file) => file.endsWith(".tgz"))
  .sort();
if (JSON.stringify(packedArchives) !== JSON.stringify(expectedArchives)) {
  console.error("packed plugin archive set does not exactly match catalog", {
    expectedArchives,
    packedArchives,
  });
  process.exit(1);
}

const catalog = {
  schema: PLUGIN_CATALOG_SCHEMA,
  target: effectiveTarget,
  entries,
};
writeFileSync(join(dest, "catalog.json"), JSON.stringify(catalog, null, 2));
writeFileSync(
  join(ROOT, "evidence/generated/plugin-catalog.json"),
  JSON.stringify(catalog, null, 2),
);
console.log(
  "pack-plugins",
  JSON.stringify(
    entries.map((e) => ({
      id: e.id,
      sha256: e.sha256.slice(0, 12),
      hasClient: e.hasClient,
    })),
  ),
);
