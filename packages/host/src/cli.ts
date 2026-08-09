/**
 * penglai — the Penglai 0.4 CLI (Host 全能力薄客户端 / bin entry).
 *
 *   penglai serve [--port N]   run the Host in the foreground
 *   penglai <command>          thin client over the local Host (see help)
 *
 * The interactive default (`penglai` / `penglai chat`) and every other
 * command dispatch through src/cli/main.ts; this file owns only the
 * process boundary: `serve` keeps the host loop alive, everything else
 * exits with the command's exit code.
 */

import * as path from "node:path";
import { parseArgs } from "node:util";
import { startServer } from "./server.js";
import { penglaiDataDir } from "./data-dir.js";
import { runCli } from "./cli/main.js";

async function serve(port: number): Promise<void> {
  const started = await startServer({ port });
  console.error(`Penglai Host serving on http://127.0.0.1:${started.port}`);
  // H7: do not print the token value to logs (credential leak). Clients
  // read it from the persisted token file instead.
  console.error(`Token file: ${path.join(penglaiDataDir(), "host.token")}`);
  console.error("Press Ctrl+C to stop.");
  const shutdown = async (sig: string): Promise<void> => {
    console.error(`\nreceived ${sig}, shutting down…`);
    await started.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

async function main(): Promise<void> {
  // `serve` keeps this process alive as the Host; everything else is a
  // thin-client command dispatched to cli/main.ts.
  if (process.argv[2] === "serve") {
    const { values } = parseArgs({
      options: { port: { type: "string" } },
      allowPositionals: true,
    });
    await serve(values.port !== undefined ? Number(values.port) : 14169);
    return;
  }
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}

main().catch((e) => {
  console.error(`fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
