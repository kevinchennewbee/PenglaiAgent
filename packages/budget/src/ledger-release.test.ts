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

test("releaseTurn treats percent and underscore in session ids literally", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-budget-rel-literal-"));
  const ledger = new BudgetLedger(join(dir, "ledger.sqlite3"));
  const now = Date.now();
  for (const reservationKey of ["s%:1:1", "safe:1:1", "s_:1:1", "solo:1:1"]) {
    ledger.admit(
      {
        reservationKey,
        estimatedTokens: 1,
        identity: { provider: "deepseek", model: "chat" },
      },
      now,
    );
  }
  assert.equal(ledger.releaseTurn("s%", 1), 1);
  assert.equal(ledger.releaseTurn("s_", 1), 1);
  const remaining = ledger.db.prepare("SELECT reservation_key FROM budget_reservations ORDER BY reservation_key").all() as Array<{ reservation_key: string }>;
  assert.deepEqual(remaining.map((row) => row.reservation_key), ["safe:1:1", "solo:1:1"]);
});
