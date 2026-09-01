import { Remote, RemoteError, remoteErrorOf } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError, type ErrorClass } from "./errors.js";

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap {
    "penglai/invalid-input": {};
    "penglai/unauthorized": {};
    "penglai/binding-stale": {};
    "penglai/dsh-unavailable": {};
    "penglai/dsh-contract-drift": {};
    "penglai/delivery-transient": {};
    "penglai/delivery-permanent": {};
    "penglai/auth-expired": {};
    "penglai/store-corrupt": {};
    "penglai/security-policy": {};
    "penglai/internal": {};
  }
}

const PENGALI_REMOTE_CODE: Record<ErrorClass, keyof import("@deepseek-ai/dsh-typert-protocol").RemoteErrorDetailsMap> = {
  INVALID_INPUT: "penglai/invalid-input",
  UNAUTHORIZED: "penglai/unauthorized",
  BINDING_STALE: "penglai/binding-stale",
  DSH_UNAVAILABLE: "penglai/dsh-unavailable",
  DSH_CONTRACT_DRIFT: "penglai/dsh-contract-drift",
  DELIVERY_TRANSIENT: "penglai/delivery-transient",
  DELIVERY_PERMANENT: "penglai/delivery-permanent",
  AUTH_EXPIRED: "penglai/auth-expired",
  STORE_CORRUPT: "penglai/store-corrupt",
  SECURITY_POLICY: "penglai/security-policy",
};

function throwRemoteBoundary(error: unknown): never {
  if (remoteErrorOf(error)) throw error;
  if (error instanceof PenglaiError) {
    const code = PENGALI_REMOTE_CODE[error.errorClass];
    throw new RemoteError(code, `Penglai request rejected: ${error.errorClass}`, {});
  }
  // Unexpected exceptions must never let Gateway serialize filesystem paths,
  // OS error strings, provider responses, or other host-private diagnostics.
  throw new RemoteError("penglai/internal", "Penglai request failed", {});
}

/**
 * Cordis may be installed in more than one alpha.2 bundle. Runtime identity
 * checks such as `ctx instanceof Context` therefore reject a valid foreign
 * Context and silently skip Remote registration. The Typert Service boundary
 * only requires Cordis' structural reflection registrar.
 */
export function isPenglaiRemoteContext(ctx: unknown): ctx is Context {
  if (!ctx || (typeof ctx !== "object" && typeof ctx !== "function")) return false;
  try {
    const reflect = Reflect.get(ctx, "reflect") as { provide?: unknown } | undefined;
    return typeof reflect?.provide === "function";
  } catch {
    return false;
  }
}

/** Mark one Typert method and preserve Penglai's expected failures on alpha.2's wire. */
export function PenglaiRemote<This extends object, Args extends unknown[], Result>(
  method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
): (this: This, ...args: Args) => Result {
  Remote(method, context);
  const source = Function.prototype.toString.call(method);
  const open = source.indexOf("(");
  const close = source.indexOf(")", open + 1);
  const parameters =
    open >= 0 && close >= 0
      ? source
          .slice(open + 1, close)
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      : [];

  const invoke = (receiver: This, args: unknown[]): Result => {
    try {
      const result = Reflect.apply(method, receiver, args) as Result;
      if (result && typeof (result as { then?: unknown }).then === "function") {
        return Promise.resolve(result).catch(throwRemoteBoundary) as Result;
      }
      return result;
    } catch (error) {
      return throwRemoteBoundary(error);
    }
  };

  // Alpha.2's source-mode Gateway derives wire fields from the actual
  // prototype function signature and rejects rest/default/destructured
  // parameters. Every Penglai settings Remote intentionally has either no
  // wire argument or one closed `input` object, so preserve those exact
  // signatures while adding the error boundary.
  if (parameters.length === 0) {
    return function penglaiRemoteNoArgs(this: This): Result {
      return invoke(this, []);
    } as unknown as (this: This, ...args: Args) => Result;
  }
  if (parameters.length === 1 && parameters[0] === "input") {
    return function penglaiRemoteInput(this: This, input: unknown): Result {
      return invoke(this, [input]);
    } as unknown as (this: This, ...args: Args) => Result;
  }
  throw new TypeError(
    `Penglai Remote ${String(context.name)} must use no parameters or one input parameter`,
  );
}

export type ApiTestErrorClass =
  | "auth"
  | "rate"
  | "model"
  | "network"
  | "timeout"
  | "adapter"
  | "empty"
  | "unknown";

export function classifyApiTestError(err: unknown): { class: ApiTestErrorClass; action: string } {
  const text = err instanceof Error ? err.message : String(err);
  if (/no adapter registered/i.test(text)) return { class: "adapter", action: "choose-registered-provider" };
  if (
    /\bAUTH\b|401|403|unauthorized|invalid.?key|authentication fails|MISSING_CREDENTIAL|no credential|no API key/i.test(
      text,
    )
  ) {
    return { class: "auth", action: "reenter-credential" };
  }
  if (/429|rate.?limit/i.test(text)) return { class: "rate", action: "retry-later" };
  if (/model.?not|unknown model|404|did not include the nonce/i.test(text)) {
    return { class: "model", action: "choose-available-model" };
  }
  if (/no durable final|did not complete/i.test(text)) {
    return { class: "empty", action: "retry" };
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(text)) {
    return { class: "timeout", action: "retry" };
  }
  if (/ENOTFOUND|ECONN|network|offline|DNS|TLS/i.test(text)) return { class: "network", action: "check-network" };
  return { class: "unknown", action: "retry" };
}

export function unwrapTypertResult<T = unknown>(result: unknown): T {
  if (result && typeof result === "object" && "ok" in result) {
    const rec = result as { ok?: unknown; value?: T; error?: unknown };
    if (rec.ok === false) {
      const failure = rec.error;
      if (
        failure &&
        typeof failure === "object" &&
        (failure as { isDSHRemoteError?: unknown }).isDSHRemoteError === true &&
        typeof (failure as { code?: unknown }).code === "string"
      ) {
        throw failure;
      }
      if (failure instanceof Error) throw failure;
      const message =
        failure && typeof failure === "object" && typeof (failure as { message?: unknown }).message === "string"
          ? String((failure as { message: string }).message)
          : "remote";
      throw new Error(message);
    }
    return rec.value as T;
  }
  return result as T;
}
