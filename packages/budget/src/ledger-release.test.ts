import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BudgetLedger } from "./ledger.js";

test("P51-BUDGET-001 releaseTurn audits reservations instead of forgetting them", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-budget-rel-"));
  const ledger = new BudgetLedger(join(dir, "ledger.sqlite3"));
  ledger.setPolicy({ scope: "global", key: "global", hardTokens: 10_000, ownerConfirmed: true });
  ledger.admit(
    {
      reservationKey: "sess:1:1",
      estimatedTokens: 20,
      identity: { provider: "deepseek", model: "chat" },
    },
    Date.now(),
  );
  assert.equal(ledger.releaseTurn("sess", 1), 1);
  const kept = ledger.db.prepare("SELECT COUNT(*) AS c FROM budget_releases").get() as { c: number };
  assert.equal(Number(kept.c), 1);
});
