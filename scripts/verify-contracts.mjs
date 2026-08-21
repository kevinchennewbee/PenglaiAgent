import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT, readJson } from "./lib/repo.mjs";
import { PINNED_DSH, PINNED_DSH_COMMIT, PINNED_DSH_INTEGRITY } from "./lib/product.mjs";

const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
if (!lock.includes(PINNED_DSH)) {
  console.error("lock missing pinned DSH version");
  process.exit(1);
}
const desktop = readJson("apps/desktop/package.json");
if (desktop.dependencies["@deepseek-ai/dsh"] !== PINNED_DSH) {
  console.error("desktop DSH pin drift");
  process.exit(1);
}
const adr = readFileSync(join(ROOT, "docs/adr/0033-dsh-011-rc1-three-targets.md"), "utf8");
if (!adr.includes(PINNED_DSH) || !adr.includes(PINNED_DSH_COMMIT)) {
  console.error("ADR 0033 missing pin/commit");
  process.exit(1);
}
const freeze = readFileSync(join(ROOT, "docs/0.5.1/DSH_FREEZE.md"), "utf8");
if (!freeze.includes(PINNED_DSH_INTEGRITY) || !freeze.includes(PINNED_DSH_COMMIT)) {
  console.error("DSH_FREEZE.md missing integrity/commit");
  process.exit(1);
}
const blob = JSON.stringify(readJson("package.json")) + JSON.stringify(desktop);
if (/openclaw/i.test(blob)) {
  console.error("root/desktop package declares OpenClaw");
  process.exit(1);
}
if (!existsSync(join(ROOT, "docs/compatibility/DSH_R2.md"))) {
  console.error("DSH_R2 compatibility note missing");
  process.exit(1);
}
const probe = spawnSync(process.execPath, [join(ROOT, "scripts/probe-dsh-contracts.mjs")], {
  cwd: ROOT,
  encoding: "utf8",
});
if (probe.status !== 0) {
  process.stderr.write(probe.stdout || "");
  process.stderr.write(probe.stderr || "");
  process.exit(probe.status ?? 1);
}
if (probe.stdout) process.stdout.write(probe.stdout);
const rc1 = spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "scripts/probe-rc1.mjs")], {
  cwd: ROOT,
  encoding: "utf8",
});
if (rc1.status !== 0) {
  process.stderr.write(rc1.stdout || "");
  process.stderr.write(rc1.stderr || "");
  process.exit(rc1.status ?? 1);
}
if (rc1.stdout) process.stdout.write(rc1.stdout);
const lockText = lock;
if (!lockText.includes("@larksuiteoapi/node-sdk@1.73.0")) {
  console.error("lock missing pinned Lark SDK");
  process.exit(1);
}
if (!lockText.includes("silk-wasm@3.7.1") || !lockText.includes("libopus-wasm@0.2.0")) {
  console.error("lock missing pinned IM audio codecs");
  process.exit(1);
}
const codecPackage = readJson("packages/audio-codecs/package.json");
if (
  codecPackage.dependencies?.["silk-wasm"] !== "3.7.1" ||
  codecPackage.dependencies?.["libopus-wasm"] !== "0.2.0"
) {
  console.error("audio codec package pin drift");
  process.exit(1);
}
const voiceCompatibility = readFileSync(join(ROOT, "docs/compatibility/VOICE_R3.md"), "utf8");
for (const pin of [
  "silk-wasm@3.7.1",
  "libopus-wasm@0.2.0",
  "55fe0b6faf9043518b7e1a7ea32e74659ecfbae7",
]) {
  if (!voiceCompatibility.includes(pin)) {
    console.error("voice compatibility document missing codec pin", pin);
    process.exit(1);
  }
}
if (/openclaw/i.test(JSON.stringify(readJson("packages/channel-feishu/package.json")))) {
  console.error("feishu package declares OpenClaw");
  process.exit(1);
}
const contractMod = await import(pathToFileURL(join(ROOT, "packages/release-identity/src/contract.ts")).href);
try {
  contractMod.assertReleaseContract(readJson("release-contract.json"));
} catch (err) {
  console.error("release-contract invalid", err);
  process.exit(1);
}
const makers = spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "scripts/probe-makers.mjs")], {
  cwd: ROOT,
  encoding: "utf8",
});
if (makers.status !== 0) {
  process.stderr.write(makers.stdout || "");
  process.stderr.write(makers.stderr || "");
  process.exit(makers.status ?? 1);
}
if (makers.stdout) process.stdout.write(makers.stdout);
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
if (readme.includes("official DSH 0.1.0-rc.8") || readme.includes("官方 DSH 0.1.0-rc.8")) {
  console.error("README still claims current DSH is 0.1.0-rc.8");
  process.exit(1);
}
if (/Apple Silicon \/ macOS 13\+ only for this candidate/.test(readme) || /本候选仅 Apple Silicon/.test(readme)) {
  console.error("README still claims 0.5.1 is Apple Silicon only");
  process.exit(1);
}
const notes051 = readFileSync(join(ROOT, "docs/RELEASE_NOTES_0.5.1.md"), "utf8");
if (notes051.includes("0.1.0-rc.8")) {
  console.error("RELEASE_NOTES_0.5.1 still pins rc.8");
  process.exit(1);
}
const findings = readFileSync(join(ROOT, "docs/0.5.1/FINDINGS.md"), "utf8");
if (/engineering-only/.test(findings) || /keep NOT_RELEASED/.test(findings)) {
  console.error("FINDINGS still treats Intel/Windows as accepted engineering-only");
  process.exit(1);
}
const ensure = readFileSync(join(ROOT, "scripts/ensure-electron.mjs"), "utf8");
if (!ensure.includes("--target") || ensure.includes("this script has no --arch")) {
  console.error("ensure-electron is still host-only");
  process.exit(1);
}
console.log("verify:contracts ok", PINNED_DSH, "lark 1.73.0", "audio codecs 3.7.1/0.2.0", "release-contract 0.5.1");
