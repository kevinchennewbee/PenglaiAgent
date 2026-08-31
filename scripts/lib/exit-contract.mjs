import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const EXIT_BY_VERDICT = {
  PASS: 0,
  FAIL: 1,
  INCOMPLETE: 2,
  STALE: 3,
  BLOCKED: 4,
};

export function parseReportFlag(argv = process.argv) {
  return argv.includes("--report") || argv.includes("--report-only");
}

export function finish(verdict, payload = {}) {
  const report = parseReportFlag();
  const rec = { verdict, ...payload };
  if (typeof rec.command === "string" && rec.command.startsWith("verify:")) {
    mkdirSync("evidence/generated", { recursive: true });
    const bytes = `${JSON.stringify(rec, null, 2)}\n`;
    const basename = rec.command.replaceAll(":", "-");
    writeFileSync(join("evidence/generated", `${basename}.json`), bytes);
    if (
      typeof rec.target === "string" &&
      ["darwin-aarch64", "darwin-x86_64", "win32-x86_64"].includes(rec.target)
    ) {
      writeFileSync(join("evidence/generated", `${basename}-${rec.target}.json`), bytes);
    }
  }
  const line = JSON.stringify(rec);
  if (verdict === "PASS") console.log(line);
  else console.error(line);
  const code = report ? 0 : (EXIT_BY_VERDICT[verdict] ?? 1);
  process.exit(code);
}
