export function productionDebuggerForbidden(argv: readonly string[], packaged: boolean): boolean {
  if (!packaged) return false;
  return argv.some((arg) => /remote-debugging-port|--inspect(-brk)?/.test(arg));
}

export function packagedIgnoresResourceOverlay(packaged: boolean): boolean {
  return packaged;
}
