export function productionDebuggerForbidden(argv: readonly string[], packaged: boolean): boolean {
  if (!packaged || process.env.PENGLAI_ALLOW_TEST_HARNESS === "1") return false;
  return argv.some((arg) => /remote-debugging-port|--inspect(-brk)?/.test(arg));
}
