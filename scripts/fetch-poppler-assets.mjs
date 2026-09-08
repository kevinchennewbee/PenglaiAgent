#!/usr/bin/env node
/** Mnemon-style CLI alias for scripts/fetch-poppler.mjs. */

import { main } from "./lib/poppler-fetch.mjs";

try {
  const code = await main(process.argv.slice(2));
  process.exit(code ?? 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
}
