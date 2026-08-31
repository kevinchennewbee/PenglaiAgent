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
