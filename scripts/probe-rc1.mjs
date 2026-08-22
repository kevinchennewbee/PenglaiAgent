import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const child = spawnSync(
  process.execPath,
  ["--import", "tsx", fileURLToPath(new URL("./probe-rc2.mjs", import.meta.url))],
  { stdio: "inherit" },
);
process.exit(child.status ?? 1);
