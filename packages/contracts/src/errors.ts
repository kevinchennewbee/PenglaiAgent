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
