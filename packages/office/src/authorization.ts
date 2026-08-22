import { PenglaiError } from "@penglai/contracts";
import { readZip } from "./zip.js";

export const MAX_OFFICE_BYTES = 8 * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

export function assertAuthorizedBytes(bytes: Buffer): void {
  if (!bytes?.length) throw new PenglaiError("INVALID_INPUT", "office bytes required");
  if (bytes.length > MAX_OFFICE_BYTES) throw new PenglaiError("SECURITY_POLICY", "office attachment too large");
  if (bytes.subarray(0, 2).toString("binary") === "PK") {
    const entries = readZip(bytes);
    let uncompressed = 0;
    for (const entry of entries) {
      if (entry.name.includes("..") || entry.name.startsWith("/") || entry.name.includes("\\")) {
        throw new PenglaiError("SECURITY_POLICY", "office zip path traversal");
      }
      uncompressed += entry.data.length;
      if (uncompressed > MAX_UNCOMPRESSED_BYTES) {
        throw new PenglaiError("SECURITY_POLICY", "office zip bomb");
      }
    }
  }
}

export function assertWorkspace(jobWorkspace: string | undefined, ctxWorkspace: string | undefined): void {
  if (jobWorkspace && ctxWorkspace && jobWorkspace !== ctxWorkspace) {
    throw new PenglaiError("SECURITY_POLICY", "office workspace isolation");
  }
}
