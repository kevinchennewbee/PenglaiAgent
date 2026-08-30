import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  readDshSourceClosureContract,
  resolveClosureOutput,
} from "./lib/dsh-source-closure.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { ROOT } from "./lib/repo.mjs";

const { values } = parseArgs({
  options: { from: { type: "string" } },
  allowPositionals: false,
});
const contract = readDshSourceClosureContract(ROOT);
const source = resolveClosureOutput(ROOT, values.from, contract);
const destination = resolve(ROOT, contract.transport.promotedRoot);
if (!existsSync(resolve(source, "closure-manifest.json"))) {
  finish("FAIL", { command: "promote:dsh-source-closure", reason: "source closure manifest is missing" });
}
rmSync(destination, { recursive: true, force: true });
mkdirSync(dirname(destination), { recursive: true });
cpSync(source, destination, { recursive: true, dereference: true });
execFileSync(process.execPath, [resolve(ROOT, "scripts/verify-dsh-vendored-closure.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
});
finish("PASS", {
  command: "promote:dsh-source-closure",
  source: contract.transport.outputRoot,
  destination: contract.transport.promotedRoot,
});
