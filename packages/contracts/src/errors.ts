import { createHash } from "node:crypto";

export const PENGLAI_ERROR_CLASSES = [
  "INVALID_INPUT",
  "UNAUTHORIZED",
  "BINDING_STALE",
  "DSH_UNAVAILABLE",
  "DSH_CONTRACT_DRIFT",
  "DELIVERY_TRANSIENT",
  "DELIVERY_PERMANENT",
  "AUTH_EXPIRED",
  "STORE_CORRUPT",
  "SECURITY_POLICY",
] as const;

export type ErrorClass = (typeof PENGLAI_ERROR_CLASSES)[number];

const ERROR_CLASS_SET = new Set<string>(PENGLAI_ERROR_CLASSES);

export function isErrorClass(value: unknown): value is ErrorClass {
  return typeof value === "string" && ERROR_CLASS_SET.has(value);
}

export class PenglaiError extends Error {
  readonly errorClass: ErrorClass;
  constructor(errorClass: ErrorClass, message: string) {
    super(message);
    this.name = "PenglaiError";
    this.errorClass = errorClass;
  }
}

export function redactedDiagnosticReference(
  prefix: string,
  ...parts: readonly string[]
): string {
  if (!/^[A-Z]{2,8}$/.test(prefix) || parts.length === 0 || parts.length > 8) {
    throw new PenglaiError("INVALID_INPUT", "diagnostic reference identity rejected");
  }
  if (parts.some((part) => typeof part !== "string" || !part || part.length > 256)) {
    throw new PenglaiError("INVALID_INPUT", "diagnostic reference input rejected");
  }
  const digest = createHash("sha256")
    .update(JSON.stringify([prefix, ...parts]))
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `${prefix}-${digest}`;
}

export const PENGLAI_ASR_FAILURE_REASONS = [
  "backpressure",
  "cancelled",
  "deadline",
  "engine-unavailable",
  "model-not-ready",
] as const;

export type PenglaiAsrFailureReason = (typeof PENGLAI_ASR_FAILURE_REASONS)[number];

export class PenglaiAsrError extends PenglaiError {
  constructor(
    errorClass: ErrorClass,
    readonly reason: PenglaiAsrFailureReason,
  ) {
    super(errorClass, `ASR_${reason.toUpperCase().replaceAll("-", "_")}`);
    this.name = "PenglaiAsrError";
  }
}
