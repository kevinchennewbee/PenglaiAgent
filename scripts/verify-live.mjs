import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";

const path = join(ROOT, "evidence/generated/live.json");
if (!existsSync(path)) {
  finish("INCOMPLETE", { command: "verify:live", reason: "no owner live-account evidence" });
}
let rec;
try {
  rec = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  finish("FAIL", { command: "verify:live", reason: `invalid live evidence JSON: ${String(error)}` });
}
const { evaluateLiveEvidence } = await import(
  pathToFileURL(join(ROOT, "packages/release-identity/src/live-evidence.ts")).href
);
const result = evaluateLiveEvidence(rec, "0.5.9");
finish(result.verdict, { command: "verify:live", reason: result.reason, acceptedPlatforms: result.acceptedPlatforms });
