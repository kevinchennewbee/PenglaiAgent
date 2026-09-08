/** Copy, sign, and sibling-datadir rules for the bundled pdftoppm helper. */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { popplerAssetForTarget } from "./poppler-assets.mjs";
import { publishedTreeDigest } from "./poppler-fetch.mjs";

export const WINDOWS_VC_RUNTIME_DLLS = Object.freeze([
  "MSVCP140.dll",
  "VCRUNTIME140.dll",
  "VCRUNTIME140_1.dll",
]);

export function assertPublishedPopplerTree(src, target) {
  if (!existsSync(src)) throw new Error(`bundled Poppler tree missing at ${src}`);
  const asset = popplerAssetForTarget(target);
  const digest = publishedTreeDigest(src);
  if (asset.publishedTreeSha256 && digest !== asset.publishedTreeSha256) {
    throw new Error(`Poppler ${target} tree ${digest} does not match pin ${asset.publishedTreeSha256}`);
  }
}

export function copyPopplerTree(src, dest, target) {
  if (target) assertPublishedPopplerTree(src, target);
  if (!existsSync(src)) throw new Error(`bundled Poppler tree missing at ${src}`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

export function adHocSignDarwinPoppler(tree) {
  const names = readdirSync(tree).filter((name) => name === "pdftoppm" || name.endsWith(".dylib"));
  if (!names.includes("pdftoppm")) throw new Error(`pdftoppm missing in ${tree}`);
  for (const name of names) {
    const path = join(tree, name);
    if (!statSync(path).isFile()) continue;
    const signed = spawnSync("codesign", ["--force", "--sign", "-", path], { encoding: "utf8" });
    if (signed.status !== 0) {
      throw new Error(`ad-hoc sign ${name} failed: ${signed.stderr || signed.stdout || signed.status}`);
    }
  }
}

export function copyWindowsPopplerDatadirSibling(popplerTree, payload) {
  const src = join(popplerTree, "share", "poppler");
  if (!existsSync(src)) throw new Error("Poppler CJK datadir missing at share/poppler");
  const dest = join(payload, "share", "poppler");
  mkdirSync(join(payload, "share"), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}

export function copyWindowsVcRuntimes(payloadDir, popplerDest) {
  const names = existsSync(payloadDir) ? readdirSync(payloadDir) : [];
  const missing = [];
  for (const wanted of WINDOWS_VC_RUNTIME_DLLS) {
    const found = names.find((name) => name.toLowerCase() === wanted.toLowerCase());
    if (!found) {
      missing.push(wanted);
      continue;
    }
    cpSync(join(payloadDir, found), join(popplerDest, found));
  }
  if (missing.length) {
    throw new Error(`Electron VC runtime missing next to Penglai.exe: ${missing.join(", ")}`);
  }
}

export function prepareRunnablePopplerHelper(publishedTree, workDir) {
  const dest = join(workDir, "poppler");
  copyPopplerTree(publishedTree, dest);
  const binary = process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm";
  const bin = join(dest, binary);
  if (!existsSync(bin)) throw new Error(`pdftoppm missing in ${publishedTree}`);
  if (process.platform === "darwin") adHocSignDarwinPoppler(dest);
  const fonts = join(dest, "fonts");
  return {
    bin,
    cwd: dest,
    env: existsSync(fonts) ? { FONTCONFIG_PATH: fonts } : {},
  };
}
