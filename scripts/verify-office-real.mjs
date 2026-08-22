import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";

const pkg = JSON.parse(readFileSync(join(ROOT, "packages/office/package.json"), "utf8"));
for (const [name, version] of [
  ["docx", "9.7.1"],
  ["exceljs", "4.4.0"],
  ["mammoth", "1.12.1"],
  ["pdf-lib", "1.17.1"],
  ["@liustack/pptfast", "0.20.0"],
]) {
  if (pkg.dependencies?.[name] !== version) {
    finish("FAIL", { command: "verify:office-real", reason: `pin ${name}` });
  }
}
const source = readFileSync(join(ROOT, "packages/office/package.json"), "utf8");
if (/univerjs-pro|dsh-univer-office/.test(source)) {
  finish("FAIL", { command: "verify:office-real", reason: "Univer Pro forbidden" });
}

const tests = spawnSync(process.execPath, ["--import", "tsx", "--test", "packages/office/src/*.test.ts"], {
  cwd: ROOT,
  encoding: "utf8",
});
if (tests.status !== 0) {
  process.stderr.write(tests.stdout || "");
  process.stderr.write(tests.stderr || "");
  finish("FAIL", { command: "verify:office-real", reason: "office unit failed" });
}
finish("PASS", { command: "verify:office-real", templates: 10 });
