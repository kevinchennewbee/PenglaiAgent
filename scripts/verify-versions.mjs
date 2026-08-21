import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";

const EXPECT = "0.5.1";
const pkgs = [join(ROOT, "package.json"), join(ROOT, "apps/desktop/package.json")];
for (const name of readdirSync(join(ROOT, "packages"))) {
  pkgs.push(join(ROOT, "packages", name, "package.json"));
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
if (info.candidateKind !== "public-community-release") bad.push(`release-info candidateKind ${info.candidateKind}`);
if (info.trustTier !== "community-verified") bad.push(`release-info trustTier ${info.trustTier}`);
if (info.generationId !== "penglai-dsh-v0.5") bad.push(`release-info generationId ${info.generationId}`);
const nvm = readFileSync(join(ROOT, ".nvmrc"), "utf8").trim();
if (nvm !== "22.22.2") bad.push(`.nvmrc ${nvm}`);
const node = execFileSync(process.execPath, ["-p", "process.version"], { encoding: "utf8" }).trim();
if (!node.startsWith("v22.22.2") && process.env.PENGLAI_ALLOW_OUTER_NODE !== "1") {
  if (!node.startsWith("v22.")) bad.push(`outer node ${node}`);
}
if (bad.length) {
  finish("FAIL", { command: "verify:versions", reason: bad.join("\n") });
}
finish("PASS", { command: "verify:versions", version: EXPECT });
