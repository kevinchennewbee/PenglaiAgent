import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Local Node prefix with headers. Avoids a live nodejs.org fetch during node-gyp. */
export function nodeGypPrefix(execPath = process.execPath) {
  const prefix = dirname(dirname(execPath));
  if (existsSync(join(prefix, "include", "node", "node.h"))) return prefix;
  return "";
}
