import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function productAdmZipCall(text: string): boolean {
  return /(?:from\s+['"]adm-zip['"]|require\s*\(\s*['"]adm-zip['"]\s*\)|import\s*\(\s*['"]adm-zip['"]\s*\)|import\s+['"]adm-zip['"])/.test(
    text,
  );
}

function isTestOrFixtureSource(relative: string): boolean {
  const path = relative.replaceAll("\\", "/");
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return true;
  if (/(?:^|\/)(?:testdata|fixtures)(?:\/|$)/.test(path)) return true;
  return false;
}

function productionAdmZipCall(relative: string, text: string): boolean {
  if (isTestOrFixtureSource(relative)) return false;
  return productAdmZipCall(text);
}

test("adm-zip call detection keeps product and build sources and ignores tests/fixtures", () => {
  const requireCall = 'const zip = require("adm-zip")';
  assert.equal(productAdmZipCall(requireCall), true);
  assert.equal(productAdmZipCall('import zip from "adm-zip"'), true);
  assert.equal(productAdmZipCall('await import("adm-zip")'), true);
  assert.equal(productAdmZipCall("onnxruntime-node>adm-zip"), false);
  assert.equal(productAdmZipCall("packageRoot(\"adm-zip\", ortReq, ort.root)"), false);

  assert.equal(isTestOrFixtureSource("packages/moss-tts/src/engine.ts"), false);
  assert.equal(isTestOrFixtureSource("scripts/pack-plugins.mjs"), false);
  assert.equal(isTestOrFixtureSource("packages/moss-tts/src/onnx-install-boundary.test.ts"), true);
  assert.equal(isTestOrFixtureSource("scripts/lib/secret-scan.test.mjs"), true);
  assert.equal(isTestOrFixtureSource("packages/runtime/testdata/probe.ts"), true);
  assert.equal(isTestOrFixtureSource("packages/office/fixtures/sample.js"), true);

  assert.equal(productionAdmZipCall("packages/moss-tts/src/engine.ts", requireCall), true);
  assert.equal(productionAdmZipCall("scripts/pack-plugins.mjs", requireCall), true);
  assert.equal(productionAdmZipCall("packages/moss-tts/src/engine.test.ts", requireCall), false);
  assert.equal(productionAdmZipCall("scripts/lib/secret-scan.test.mjs", requireCall), false);
  assert.equal(productionAdmZipCall("packages/runtime/testdata/probe.ts", requireCall), false);
  assert.equal(
    productionAdmZipCall("packages/moss-tts/src/onnx-install-boundary.test.ts", requireCall),
    false,
  );
});

test("adm-zip detector matches multiline and common product import forms", () => {
  const multilineRequire = 'const zip = require(\n  "adm-zip"\n);';
  const multilineDynamic = 'const zip = await import(\n "adm-zip"\n);';
  const markedProduct = 'const zip = require("adm-zip"); // penglai-test-fixture';

  assert.equal(productAdmZipCall(multilineRequire), true);
  assert.equal(productAdmZipCall(multilineDynamic), true);
  assert.equal(productAdmZipCall(markedProduct), true);
  assert.equal(productionAdmZipCall("packages/moss-tts/src/engine.ts", multilineRequire), true);
  assert.equal(productionAdmZipCall("scripts/pack-plugins.mjs", multilineDynamic), true);
  assert.equal(productionAdmZipCall("packages/moss-tts/src/engine.ts", markedProduct), true);

  assert.equal(productAdmZipCall('import "adm-zip"'), true);
  assert.equal(productAdmZipCall("import 'adm-zip'"), true);
  assert.equal(productAdmZipCall('import * as zip from "adm-zip"'), true);
  assert.equal(productAdmZipCall("import zip from 'adm-zip'"), true);
  assert.equal(productAdmZipCall('const zip = require ( "adm-zip" )'), true);
  assert.equal(productAdmZipCall("const zip = require('adm-zip')"), true);
  assert.equal(productAdmZipCall('const zip = await import ( "adm-zip" )'), true);

  assert.equal(
    productionAdmZipCall("packages/moss-tts/src/onnx-install-boundary.test.ts", multilineRequire),
    false,
  );
  assert.equal(productionAdmZipCall("packages/moss-tts/src/engine.test.ts", multilineDynamic), false);
  assert.equal(productionAdmZipCall("packages/runtime/testdata/probe.ts", markedProduct), false);
  assert.equal(productionAdmZipCall("packages/office/fixtures/sample.js", 'import "adm-zip"'), false);
});

test("adm-zip destination-symlink extraction is not a product or authorized-build call path", () => {
  const npmrc = readFileSync(join(root, ".npmrc"), "utf8");
  assert.match(npmrc, /^ignore-scripts=true$/m);

  const workspace = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  assert.match(workspace, /'onnxruntime-node>adm-zip': '0\.6\.1'/);
  assert.match(workspace, /- 'adm-zip@0\.6\.1'/);

  const pack = readFileSync(join(root, "scripts/pack-plugins.mjs"), "utf8");
  assert.match(pack, /function vendorMossRuntime/);
  assert.doesNotMatch(pack, /script\/install|onnxruntime-node-install|ONNXRUNTIME_NODE_INSTALL/);
  assert.equal(productionAdmZipCall("scripts/pack-plugins.mjs", pack), false);

  const tracked = execFileSync(
    "git",
    ["ls-files", "apps", "packages", "scripts", ".github", ".npmrc", "package.json", "pnpm-workspace.yaml"],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const callers = [];
  for (const relative of tracked) {
    if (!/\.(?:[cm]?js|ts|json|ya?ml|mjs)$/.test(relative) && relative !== ".npmrc") continue;
    const text = readFileSync(join(root, relative), "utf8");
    if (productionAdmZipCall(relative, text)) callers.push(relative);
  }
  assert.deepEqual(callers, []);
  assert.equal(
    tracked.includes("packages/moss-tts/src/onnx-install-boundary.test.ts"),
    true,
  );

  const ortPackage = join(root, "node_modules/onnxruntime-node/package.json");
  assert.equal(existsSync(ortPackage), true);
  const ort = JSON.parse(readFileSync(ortPackage, "utf8")) as { scripts?: { postinstall?: string } };
  assert.equal(ort.scripts?.postinstall, "node ./script/install");
  const install = readFileSync(join(root, "node_modules/onnxruntime-node/script/install.js"), "utf8");
  const utils = readFileSync(join(root, "node_modules/onnxruntime-node/script/install-utils.js"), "utf8");
  const main = readFileSync(join(root, "node_modules/onnxruntime-node/dist/index.js"), "utf8");
  assert.match(install, /install-utils/);
  assert.match(utils, /AdmZip/);
  assert.match(utils, /extractEntryTo/);
  assert.doesNotMatch(main, /adm-zip|AdmZip|extractEntryTo|extractAllTo/);
  const runtime = readFileSync(join(root, "packages/moss-tts/src/third_party/moss_tts/runtime.mjs"), "utf8");
  assert.match(runtime, /from "onnxruntime-node"/);
  assert.doesNotMatch(runtime, /adm-zip|AdmZip|extractEntryTo|extractAllTo/);
});

test("adm-zip refuses extraction through an existing destination symlink", (context) => {
  const require = createRequire(import.meta.url);
  const AdmZip = require("adm-zip") as new () => {
    addFile(name: string, bytes: Buffer): void;
    extractAllTo(destination: string, overwrite: boolean): void;
  };
  const fixture = mkdtempSync(join(tmpdir(), "penglai-adm-zip-symlink-"));
  const extractionRoot = join(fixture, "extract");
  const outsideRoot = join(fixture, "outside");
  const outsideFile = join(outsideRoot, "payload.txt");
  mkdirSync(extractionRoot);
  mkdirSync(outsideRoot);
  writeFileSync(outsideFile, "original", { mode: 0o600 });
  try {
    try {
      symlinkSync(outsideRoot, join(extractionRoot, "link"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code === "EPERM" || code === "EACCES") {
        context.skip(`destination symlinks unavailable on this host: ${code}`);
        return;
      }
      throw error;
    }
    const archive = new AdmZip();
    archive.addFile("link/payload.txt", Buffer.from("attacker-controlled"));
    assert.throws(() => archive.extractAllTo(extractionRoot, true));
    assert.equal(readFileSync(outsideFile, "utf8"), "original");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
