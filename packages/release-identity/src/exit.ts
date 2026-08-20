export type VerifierVerdict = "PASS" | "FAIL" | "INCOMPLETE" | "STALE" | "BLOCKED";

export const EXIT_BY_VERDICT: Record<VerifierVerdict, number> = {
  PASS: 0,
  FAIL: 1,
  INCOMPLETE: 2,
  STALE: 3,
  BLOCKED: 4,
};

export function exitCodeForVerdict(verdict: VerifierVerdict, report = false): number {
  if (report) return 0;
  return EXIT_BY_VERDICT[verdict];
}

export function parseReportFlag(argv: readonly string[] = process.argv): boolean {
  return argv.includes("--report") || argv.includes("--report-only");
}

export function assertIncompleteIsNonZero(verdict: VerifierVerdict, exitCode: number, report = false): void {
  if (report) return;
  if (verdict !== "PASS" && exitCode === 0) {
    throw new Error(`${verdict} must not exit 0`);
  }
  if (verdict === "INCOMPLETE" && exitCode === 0) {
    throw new Error("INCOMPLETE must not exit 0");
  }
}
