export type ErrorClass =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "BINDING_STALE"
  | "DSH_UNAVAILABLE"
  | "DSH_CONTRACT_DRIFT"
  | "DELIVERY_TRANSIENT"
  | "DELIVERY_PERMANENT"
  | "AUTH_EXPIRED"
  | "STORE_CORRUPT"
  | "SECURITY_POLICY";

export class PenglaiError extends Error {
  readonly errorClass: ErrorClass;
  constructor(errorClass: ErrorClass, message: string) {
    super(message);
    this.name = "PenglaiError";
    this.errorClass = errorClass;
  }
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
