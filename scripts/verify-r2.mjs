import { spawnSync } from "node:child_process";

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
  const r = spawnSync("pnpm", ["run", s], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const ev = spawnSync("pnpm", ["run", "evidence:r2"], { stdio: "inherit" });
if (ev.status !== 0) process.exit(ev.status ?? 1);
console.log("verify:r2 ok");
