import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const retiredChannel = "whatsapp";
const retiredPackages = [
  "@penglai/channel-whatsapp",
  "@whiskeysockets/baileys",
  "libsignal",
  "whatsapp-rust-bridge",
];
const failures = [];

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function existingFilesUnder(paths) {
  return git(["ls-files", "--cached", "--others", "--exclude-standard", "--", ...paths])
    .split("\n")
    .filter(Boolean)
    .filter((path) => existsSync(join(ROOT, path)));
}

const activeCode = existingFilesUnder(["apps", "packages"])
  .filter((path) => /\.(?:[cm]?js|tsx?)$/.test(path))
  .filter((path) => path !== "packages/release-identity/src/public-docs.test.ts");
for (const path of activeCode) {
  const text = readFileSync(join(ROOT, path), "utf8");
  if (text.toLowerCase().includes(retiredChannel)) {
    failures.push(`${path} still contains the retired channel identity`);
  }
  if (/community-protocol|acknowledgeChannelRisk|acknowledgeRisk|CHANNEL_RISK_ACK|riskAck|risk_ack_at/.test(text)) {
    failures.push(`${path} still contains the retired risk-acknowledgement path`);
  }
}

const graphFiles = existingFilesUnder(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "apps", "packages"])
  .filter((path) => path === "pnpm-lock.yaml" || path === "pnpm-workspace.yaml" || /(?:^|\/)(?:package|tsconfig)(?:\.[^/]*)?\.json$/.test(path));
for (const path of graphFiles) {
  const text = readFileSync(join(ROOT, path), "utf8");
  for (const name of retiredPackages) {
    if (text.includes(name)) failures.push(`${path} still contains retired package ${name}`);
  }
  if (text.toLowerCase().includes("channel-whatsapp")) {
    failures.push(`${path} still contains the retired workspace path`);
  }
}

for (const path of [
  "packages/channel-whatsapp/package.json",
  "packages/channel-whatsapp/tsconfig.json",
  "packages/im/src/adapters/whatsapp.ts",
  "packages/im/src/adapters/whatsapp.test.ts",
]) {
  if (existsSync(join(ROOT, path))) failures.push(`${path} still exists`);
}

if (failures.length > 0) {
  console.error(JSON.stringify({
    schema: 1,
    gate: "retired-channel-absence",
    result: "FAIL",
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema: 1,
  gate: "retired-channel-absence",
  result: "PASS",
  activeCodeFilesChecked: activeCode.length,
  dependencyGraphFilesChecked: graphFiles.length,
  retiredPackageCount: retiredPackages.length,
}, null, 2));
