import { spawnSync } from "node:child_process";
import { pnpmProcess } from "./lib/pnpm-process.mjs";

const steps = [
  "format:check",
  "typecheck",
  "test:unit",
  "test:contract",
  "test:integration",
  "test:e2e",
  "test:security",
  "test:chaos",
  "test:soak",
  "audit:secrets",
  "audit:dependencies",
  "audit:licenses",
  "sbom",
  "build",
  "package:mac",
];

for (const s of steps) {
  console.log("::verify", s);
  const child = pnpmProcess(["run", s]);
  const r = spawnSync(child.command, child.args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const ev = spawnSync(process.execPath, ["scripts/write-evidence.mjs"], { stdio: "inherit" });
if (ev.status !== 0) process.exit(ev.status ?? 1);
console.log("verify:r1 ok");
