import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function productAdmZipCall(text: string): boolean {
  return /(?:from\s+['"]adm-zip['"]|require\(\s*['"]adm-zip['"]\s*\)|import\(\s*['"]adm-zip['"]\s*\))/.test(
    text,
  );
}

test("adm-zip destination-symlink extraction is not a product or authorized-build call path", () => {
  assert.equal(productAdmZipCall('const zip = require("adm-zip")'), true);
  assert.equal(productAdmZipCall("onnxruntime-node>adm-zip"), false);
  assert.equal(productAdmZipCall("packageRoot(\"adm-zip\", ortReq, ort.root)"), false);

  const npmrc = readFileSync(join(root, ".npmrc"), "utf8");
  assert.match(npmrc, /^ignore-scripts=true$/m);

  const workspace = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  assert.match(workspace, /'onnxruntime-node>adm-zip': '0\.6\.0'/);

  const pack = readFileSync(join(root, "scripts/pack-plugins.mjs"), "utf8");
  assert.match(pack, /function vendorMossRuntime/);
  assert.doesNotMatch(pack, /script\/install|onnxruntime-node-install|ONNXRUNTIME_NODE_INSTALL/);
  assert.doesNotMatch(pack, /productAdmZipCall|require\("adm-zip"\)/);

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
    if (productAdmZipCall(text)) callers.push(relative);
  }
  assert.deepEqual(callers, []);

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
