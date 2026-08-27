import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";
import { pnpmProcess } from "./lib/pnpm-process.mjs";

const steps = ["test:failure-baseline", "test:unit", "test:contract", "test:security", "verify:evidence"];
for (const s of steps) {
  const child = pnpmProcess(["run", s]);
  const r = spawnSync(child.command, child.args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log("evidence:r2 ok");
