#!/usr/bin/env node
/**
 * `penglai` bin launcher.
 *
 * The CLI is TypeScript; this thin launcher runs it under the workspace's
 * pinned tsx loader and forwards argv, stdio, and the exit code. (The
 * packaged M3′ installer replaces this with a compiled entry.)
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsx = require.resolve("tsx");
const entry = path.join(here, "..", "src", "cli.ts");

const child = spawn(process.execPath, ["--import", tsx, entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
child.on("error", (error) => {
  console.error(`penglai: failed to start: ${error.message}`);
  process.exit(1);
});
