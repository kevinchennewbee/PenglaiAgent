import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";

const path = join(ROOT, "evidence/generated/live.json");
if (!existsSync(path)) {
  finish("INCOMPLETE", { command: "verify:live", reason: "no 0.5 live evidence" });
}
const rec = JSON.parse(readFileSync(path, "utf8"));
if (rec.productVersion !== "0.5.2") {
  finish("STALE", { command: "verify:live", reason: "live evidence is not 0.5.2" });
}
finish("INCOMPLETE", { command: "verify:live", reason: "final live is reserved for RC15" });
