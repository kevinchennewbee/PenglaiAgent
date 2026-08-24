import { createHash } from "node:crypto";
import { PenglaiError, type ErrorClass } from "./errors.js";

export function parseClosedEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
  errorClass: ErrorClass = "STORE_CORRUPT",
): T[number] {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T[number];
  }
  throw new PenglaiError(errorClass, `UNKNOWN_${label}`);
}

export function assertSha256(bytes: Buffer, expected: string): string {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const want = expected.replace(/^sha256:/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want) || digest !== want) {
    throw new PenglaiError("SECURITY_POLICY", "SEND_ARTIFACT_DIGEST_MISMATCH");
  }
  return digest;
}
