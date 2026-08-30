import { isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import {
  readReleaseIdentityPins,
  RELEASE_PINS_SOURCE,
} from "./lib/release-pins-source.mjs";

const pins = readReleaseIdentityPins();
const EXPECT = pins.productVersion;
const pkgs = [join(ROOT, "package.json"), join(ROOT, "apps/desktop/package.json")];
for (const name of readdirSync(join(ROOT, "packages"))) {
  const manifest = join(ROOT, "packages", name, "package.json");
  if (existsSync(manifest)) pkgs.push(manifest);
}
const bad = [];
for (const p of pkgs) {
  const j = JSON.parse(readFileSync(p, "utf8"));
  if (j.version !== EXPECT) bad.push(`${p}: ${j.version}`);
}
const seed = JSON.parse(readFileSync(join(ROOT, "profile-seed/web/package.json"), "utf8"));
for (const [name, ver] of Object.entries(seed.dependencies ?? {})) {
  if (String(name).startsWith("@penglai/") && ver !== EXPECT) {
    bad.push(`profile-seed ${name}: ${ver}`);
  }
}
const info = JSON.parse(readFileSync(join(ROOT, "release-info.json"), "utf8"));
if (info.productVersion !== EXPECT) bad.push(`release-info ${info.productVersion}`);
for (const [key, expected] of Object.entries({
  productName: pins.productName,
  candidateKind: pins.candidateKind,
  trustTier: pins.trustTier,
  generationId: pins.generationId,
  signatureKind: pins.signatureKind,
  node: pins.node,
  embeddedNode: pins.node,
  pnpm: pins.pnpm,
  electron: pins.electron,
  dsh: pins.dsh,
  profileSchema: pins.profileSchema,
  catalogSchema: pins.catalogSchema,
  imSchema: pins.imSchema,
})) {
  if (info[key] !== expected) bad.push(`release-info ${key}: ${info[key]}`);
}
if (!isDeepStrictEqual(info.publication, pins.publication))
  bad.push("release-info publication target drifted from pins.ts");
if (!isDeepStrictEqual(info.targets, pins.targets))
  bad.push("release-info release targets drifted from pins.ts");
if (!isDeepStrictEqual(info.dshSource, pins.dshSource))
  bad.push("release-info DSH source closure drifted from pins.ts");
const nvm = readFileSync(join(ROOT, ".nvmrc"), "utf8").trim();
if (nvm !== pins.node) bad.push(`.nvmrc ${nvm}`);
const node = execFileSync(process.execPath, ["-p", "process.version"], { encoding: "utf8" }).trim();
if (!node.startsWith(`v${pins.node}`) && process.env.PENGLAI_ALLOW_OUTER_NODE !== "1") {
  if (!node.startsWith("v22.")) bad.push(`outer node ${node}`);
}
if (bad.length) {
  finish("FAIL", { command: "verify:versions", reason: bad.join("\n") });
}
finish("PASS", {
  command: "verify:versions",
  version: EXPECT,
  dsh: pins.dsh,
  authority: RELEASE_PINS_SOURCE,
});
