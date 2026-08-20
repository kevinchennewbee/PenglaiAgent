import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";

for (const script of ["audit:dependencies", "audit:licenses"]) {
  const r = spawnSync("pnpm", ["run", script], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log("verify:dependencies ok");
