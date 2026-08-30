import assert from "node:assert/strict";
import test from "node:test";
import { applyRecoveryDiagnostic } from "./recovery-diagnostic.js";

function fixture() {
  const exhausted = [
    { hidden: true, textContent: null },
    { hidden: true, textContent: null },
  ];
  const reference = { hidden: true, textContent: null as string | null };
  const referenceRow = { hidden: true, textContent: null };
  const body = { dataset: {} as DOMStringMap };
  return {
    exhausted,
    reference,
    referenceRow,
    body,
    documentPort: {
      body,
      querySelector: (selector: string) =>
        selector.endsWith("reference]") ? reference : referenceRow,
      querySelectorAll: () => exhausted,
    } as unknown as Document,
  };
}

test("validated recovery diagnostics update the recovery document without code evaluation", () => {
  const page = fixture();
  assert.equal(
    applyRecoveryDiagnostic(page.documentPort, {
      status: "manual-action-required",
      referenceId: "CORE-A1B2C3D4E5F6",
    }),
    true,
  );
  assert.equal(
    page.body.dataset.penglaiRecoveryState,
    "manual-action-required",
  );
  assert.equal(
    page.exhausted.every((row) => row.hidden === false),
    true,
  );
  assert.equal(page.reference.textContent, "CORE-A1B2C3D4E5F6");
  assert.equal(page.referenceRow.hidden, false);
});

test("recovery diagnostics reject untrusted status and reference values", () => {
  for (const payload of [
    null,
    {
      status: "manual-action-required;alert(1)",
      referenceId: "CORE-A1B2C3D4E5F6",
    },
    { status: "idle", referenceId: "</script>" },
  ]) {
    const page = fixture();
    assert.equal(applyRecoveryDiagnostic(page.documentPort, payload), false);
    assert.deepEqual(page.body.dataset, {});
    assert.equal(page.reference.textContent, null);
  }
});
