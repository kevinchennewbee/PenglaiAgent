import { PenglaiError } from "@penglai/contracts";
import { OFFICE_ZIP_LIMITS, readZip } from "./zip.js";

export const MAX_OFFICE_BYTES = OFFICE_ZIP_LIMITS.archiveBytes;
export const MAX_UNCOMPRESSED_BYTES = OFFICE_ZIP_LIMITS.totalUncompressedBytes;

export function assertAuthorizedBytes(bytes: Buffer): void {
  if (!bytes?.length) throw new PenglaiError("INVALID_INPUT", "office bytes required");
  if (bytes.length > MAX_OFFICE_BYTES) throw new PenglaiError("SECURITY_POLICY", "office attachment too large");
  if (bytes.subarray(0, 2).toString("binary") === "PK") {
    readZip(bytes);
  }
}

export function assertWorkspace(jobWorkspace: string | undefined, ctxWorkspace: string | undefined): void {
  if (jobWorkspace && ctxWorkspace && jobWorkspace !== ctxWorkspace) {
    throw new PenglaiError("SECURITY_POLICY", "office workspace isolation");
  }
}
