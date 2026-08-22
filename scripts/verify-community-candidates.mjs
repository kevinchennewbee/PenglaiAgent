import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";

const ledger = readFileSync(join(ROOT, "docs/0.5.5/COMMUNITY_REVIEW_LEDGER.md"), "utf8");
if (!ledger.includes("QUARANTINED")) finish("FAIL", { command: "verify:community-candidates", reason: "ledger missing verdicts" });
if (/curl\s*\|\s*bash/.test(ledger)) {
  finish("FAIL", { command: "verify:community-candidates", reason: "curl|bash forbidden" });
}
if (/\|\s*APPROVED\s*\|/.test(ledger)) {
  finish("FAIL", { command: "verify:community-candidates", reason: "no APPROVED community plugins in 0.5.5 client" });
}
finish("PASS", { command: "verify:community-candidates", shipped: 0 });
