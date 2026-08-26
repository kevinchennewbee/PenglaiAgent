import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";
import { pnpmProcess } from "./lib/pnpm-process.mjs";

for (const script of ["audit:dependencies", "audit:licenses"]) {
  const child = pnpmProcess(["run", script]);
  const r = spawnSync(child.command, child.args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log("verify:dependencies ok");
