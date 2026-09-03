import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { parseTargetArg } from "./lib/release-targets.mjs";
import { PRODUCT_VERSION } from "./lib/product.mjs";

const target = parseTargetArg();
const suffix = { "darwin-aarch64": "macos_aarch64.dmg", "darwin-x86_64": "macos_x64.dmg", "win32-x86_64": "windows_x64_setup.exe" }[target];
if (!suffix) throw new Error("unsupported upgrade source target");
const pins = JSON.parse(readFileSync(join(ROOT, `docs/${PRODUCT_VERSION}/UPGRADE_SOURCES.json`), "utf8"));
for (const source of pins.sources) {
  const name = `Penglai_${source.version}_${suffix}`;
  const pinned = source.assets.find((asset) => asset.name === name);
  if (!pinned) throw new Error(`missing pinned upgrade source ${name}`);
  const release = JSON.parse(execFileSync("gh", ["api", `repos/${pins.repository}/releases/tags/${source.tag}`], { encoding: "utf8" }));
  const asset = release.assets?.find((row) => row.name === name);
  if (release.id !== source.releaseId || release.tag_name !== source.tag || release.target_commitish !== source.sourceSha || release.immutable !== true || release.draft || !asset || asset.id !== pinned.id || asset.size !== pinned.size || asset.digest !== `sha256:${pinned.sha256}`) {
    throw new Error(`immutable upgrade source identity drift: ${name}`);
  }
  const directory = join(ROOT, ".previous", source.version);
  mkdirSync(directory, { recursive: true });
  execFileSync("gh", ["release", "download", source.tag, "--repo", pins.repository, "--pattern", name, "--dir", directory, "--clobber"], { stdio: "inherit" });
  const bytes = readFileSync(join(directory, name));
  if (bytes.length !== pinned.size || createHash("sha256").update(bytes).digest("hex") !== pinned.sha256) {
    throw new Error(`upgrade source download digest mismatch: ${name}`);
  }
  console.log(JSON.stringify({ version: source.version, target, installer: name, sha256: pinned.sha256, verified: true }));
}
