import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sanitizeEvidenceValue, writeEvidenceJson } from "./evidence-json.mjs";

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
  const rec = sanitizeEvidenceValue({ verdict, ...payload });
  if (typeof rec.command === "string" && rec.command.startsWith("verify:")) {
    mkdirSync("evidence/generated", { recursive: true });
    const basename = rec.command.replaceAll(":", "-");
    writeEvidenceJson(join("evidence/generated", `${basename}.json`), rec, {
      root: "evidence/generated",
    });
    if (
      typeof rec.target === "string" &&
      ["darwin-aarch64", "darwin-x86_64", "win32-x86_64", "linux-loong64"].includes(rec.target)
    ) {
      writeEvidenceJson(join("evidence/generated", `${basename}-${rec.target}.json`), rec, {
        root: "evidence/generated",
      });
    }
  }
  const line = JSON.stringify(rec);
  if (verdict === "PASS") console.log(line);
  else console.error(line);
  const code = report ? 0 : (EXIT_BY_VERDICT[verdict] ?? 1);
  process.exit(code);
}
