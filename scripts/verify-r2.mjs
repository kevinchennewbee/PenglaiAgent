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
  "verify:artifact",
  "probe:r2",
];

for (const s of steps) {
  console.log("::verify:r2", s);
  const child = pnpmProcess(["run", s]);
  const r = spawnSync(child.command, child.args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const evidence = pnpmProcess(["run", "evidence:r2"]);
const ev = spawnSync(evidence.command, evidence.args, { stdio: "inherit" });
if (ev.status !== 0) process.exit(ev.status ?? 1);
console.log("verify:r2 ok");
