import { existsSync } from "node:fs";

/**
 * Re-enter the exact pnpm CLI that launched the current package script.
 * This avoids resolving an unrelated global pnpm/Node pair on Windows.
 */
export function pnpmProcess(args) {
  const execPath = process.env.npm_execpath;
  if (execPath && existsSync(execPath)) {
    return { command: process.execPath, args: [execPath, ...args] };
  }
  return { command: process.platform === "win32" ? "pnpm.cmd" : "pnpm", args };
}
