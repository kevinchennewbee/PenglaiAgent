import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";

const steps = ["test:failure-baseline", "test:unit", "test:contract", "test:security", "verify:evidence"];
for (const s of steps) {
  const r = spawnSync("pnpm", ["run", s], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log("evidence:r2 ok");
