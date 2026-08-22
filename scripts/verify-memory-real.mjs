import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { MNEMON_ASSETS } from "../packages/memory/src/engine/mnemon-provider.ts";

const lock = JSON.parse(readFileSync(join(ROOT, "third_party/sources.lock.json"), "utf8"));
const mnemon = lock.sources.find((row) => row.id === "mnemon");
if (!mnemon || mnemon.assets.length !== 3) finish("FAIL", { command: "verify:memory-real", reason: "sources.lock mnemon assets" });

const tests = spawnSync(process.execPath, ["--import", "tsx", "--test", "packages/memory/src/*.test.ts"], {
  cwd: ROOT,
  encoding: "utf8",
});
if (tests.status !== 0) {
  process.stderr.write(tests.stdout || "");
  process.stderr.write(tests.stderr || "");
  finish("FAIL", { command: "verify:memory-real", reason: "memory unit failed" });
}

const present = MNEMON_ASSETS.filter((asset) =>
  existsSync(join(ROOT, "third_party/mnemon/bin", asset.target, asset.binary)),
);
if (present.length !== 3) {
  finish("INCOMPLETE", {
    command: "verify:memory-real",
    reason: "mnemon native binaries not fully fetched",
    present: present.map((row) => row.target),
  });
}
finish("PASS", { command: "verify:memory-real", binaries: present.map((row) => row.target) });
