export const RECOVERY_DIAGNOSTIC_CHANNEL = "penglai:recovery-diagnostic";

const RECOVERY_STATES = new Set([
  "idle",
  "recovering",
  "recovered",
  "manual-action-required",
]);
const REFERENCE_ID = /^CORE-[A-F0-9]{12}$/;

export function applyRecoveryDiagnostic(
  documentPort: Document,
  payload: unknown,
): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return false;
  const { status, referenceId } = payload as Record<string, unknown>;
  if (typeof status !== "string" || !RECOVERY_STATES.has(status)) return false;
  if (typeof referenceId !== "string" || !REFERENCE_ID.test(referenceId))
    return false;

  documentPort.body.dataset.penglaiRecoveryState = status;
  const exhaustedRows = documentPort.querySelectorAll(
    "[data-penglai-recovery-exhausted]",
  );
  for (let index = 0; index < exhaustedRows.length; index += 1) {
    (exhaustedRows[index] as HTMLElement).hidden =
      status !== "manual-action-required";
  }
  const reference = documentPort.querySelector<HTMLElement>(
    "[data-penglai-recovery-reference]",
  );
  const referenceRow = documentPort.querySelector<HTMLElement>(
    "[data-penglai-recovery-reference-row]",
  );
  if (reference) reference.textContent = referenceId;
  if (referenceRow) referenceRow.hidden = false;
  return true;
}
