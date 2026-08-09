/**
 * Cost-visibility helpers (0.4.0 design §7 成本可见性).
 *
 * Usage is aggregated by the owner's LOCAL calendar day (YYYY-MM-DD) so the
 * "today" row in `penglai status` matches what the owner means by today.
 */

/** The local calendar day (YYYY-MM-DD) for a timestamp on this machine. */
export function localDay(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
