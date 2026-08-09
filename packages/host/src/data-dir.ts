import os from "node:os";
import path from "node:path";

/** One authoritative root for product data, credentials, and recovery state. */
export function penglaiDataDir(): string {
  const configured = process.env.PENGLAI_DATA_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(os.homedir(), ".penglai");
}
