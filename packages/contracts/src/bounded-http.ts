import { PenglaiError, type ErrorClass } from "./errors.js";

export const BOUNDED_HTTP_MAX_BYTES = {
  registryMetadata: 1 * 1024 * 1024,
  weixinIlink: 4 * 1024 * 1024,
  feishuRegistration: 1 * 1024 * 1024,
} as const;

export type BoundedHttpCategory =
  | "registry-metadata"
  | "weixin-ilink"
  | "feishu-registration"
  | "generic";

export interface BoundedHttpHeaders {
  get(name: string): string | null;
}

export interface BoundedHttpResponse {
  ok?: boolean;
  status: number;
  headers?: BoundedHttpHeaders;
  body?: ReadableStream<Uint8Array> | null;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
}

export interface BoundedHttpLog {
  category: BoundedHttpCategory;
  status: number;
  bytes: number;
  durationMs: number;
  errorClass?: ErrorClass;
}

export interface ReadBoundedResponseInput {
  response: BoundedHttpResponse;
  maxBytes: number;
  category: BoundedHttpCategory;
  signal?: AbortSignal;
  timeoutMs?: number;
  mimeAllowed?: (contentType: string | null) => boolean;
  onLog?: (log: BoundedHttpLog) => void;
}

const TOO_LARGE = "BOUNDED_HTTP_TOO_LARGE";
const DECLARED_LENGTH = "BOUNDED_HTTP_DECLARED_LENGTH";
const MIME = "BOUNDED_HTTP_MIME";
const TIMEOUT = "BOUNDED_HTTP_TIMEOUT";
const CANCELED = "BOUNDED_HTTP_CANCELED";
const JSON_CODE = "BOUNDED_HTTP_JSON";

export function jsonMimeAllowed(contentType: string | null): boolean {
  if (contentType === null || contentType.trim().length === 0) return true;
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return mime === "application/json" || mime === "text/json" || mime.endsWith("+json");
}

function header(response: BoundedHttpResponse, name: string): string | null {
  return response.headers?.get(name) ?? null;
}

function throwAbort(timeout: AbortSignal | undefined, signal: AbortSignal | undefined): never {
  if (timeout?.aborted) throw new PenglaiError("DELIVERY_TRANSIENT", TIMEOUT);
  if (signal?.aborted) throw new PenglaiError("DELIVERY_TRANSIENT", CANCELED);
  throw new PenglaiError("DELIVERY_TRANSIENT", CANCELED);
}

function emitLog(
  onLog: ((log: BoundedHttpLog) => void) | undefined,
  log: BoundedHttpLog,
): void {
  onLog?.(log);
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    /* already closed */
  }
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  combined: AbortSignal | undefined,
  timeout: AbortSignal | undefined,
  caller: AbortSignal | undefined,
): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let seen = 0;
  const onAbort = (): void => {
    void cancelReader(reader);
  };
  combined?.addEventListener("abort", onAbort, { once: true });
  try {
    if (combined?.aborted) throwAbort(timeout, caller);
    for (;;) {
      if (combined?.aborted) throwAbort(timeout, caller);
      const { done, value } = await reader.read();
      if (combined?.aborted) throwAbort(timeout, caller);
      if (done) break;
      const chunk = Buffer.from(value);
      seen += chunk.length;
      if (seen > maxBytes) {
        await cancelReader(reader);
        throw new PenglaiError("SECURITY_POLICY", TOO_LARGE);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof PenglaiError) throw error;
    if (combined?.aborted) throwAbort(timeout, caller);
    throw error;
  } finally {
    combined?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* released by cancel */
    }
  }
}

async function readFallback(
  response: BoundedHttpResponse,
  maxBytes: number,
  combined: AbortSignal | undefined,
  timeout: AbortSignal | undefined,
  caller: AbortSignal | undefined,
): Promise<Buffer> {
  if (combined?.aborted) throwAbort(timeout, caller);
  let bytes: Buffer;
  if (typeof response.arrayBuffer === "function") {
    bytes = Buffer.from(await response.arrayBuffer());
  } else if (typeof response.text === "function") {
    bytes = Buffer.from(await response.text(), "utf8");
  } else {
    throw new PenglaiError("DELIVERY_TRANSIENT", "BOUNDED_HTTP_EMPTY");
  }
  if (combined?.aborted) throwAbort(timeout, caller);
  if (bytes.length > maxBytes) throw new PenglaiError("SECURITY_POLICY", TOO_LARGE);
  return bytes;
}

export async function readBoundedResponse(input: ReadBoundedResponseInput): Promise<{
  bytes: Buffer;
  status: number;
  contentType: string | null;
}> {
  const started = Date.now();
  const timeout = input.timeoutMs !== undefined ? AbortSignal.timeout(input.timeoutMs) : undefined;
  const combined =
    timeout && input.signal ? AbortSignal.any([timeout, input.signal]) : (timeout ?? input.signal);
  const status = input.response.status;
  const contentType = header(input.response, "content-type");
  const log = (errorClass: ErrorClass | undefined, bytes: number): void => {
    emitLog(input.onLog, {
      category: input.category,
      status,
      bytes,
      durationMs: Date.now() - started,
      ...(errorClass ? { errorClass } : {}),
    });
  };
  try {
    if (combined?.aborted) throwAbort(timeout, input.signal);
    if (input.maxBytes <= 0) throw new PenglaiError("SECURITY_POLICY", TOO_LARGE);
    if (input.mimeAllowed && !input.mimeAllowed(contentType)) {
      throw new PenglaiError("SECURITY_POLICY", MIME);
    }
    const declared = header(input.response, "content-length");
    if (declared !== null && declared !== "") {
      const n = Number(declared);
      if (!Number.isFinite(n) || n < 0 || n > input.maxBytes) {
        const body = input.response.body;
        if (body && typeof body.cancel === "function") await body.cancel();
        throw new PenglaiError("SECURITY_POLICY", DECLARED_LENGTH);
      }
    }
    const body = input.response.body;
    const bytes =
      body && typeof body.getReader === "function"
        ? await readStream(body, input.maxBytes, combined, timeout, input.signal)
        : await readFallback(input.response, input.maxBytes, combined, timeout, input.signal);
    log(undefined, bytes.length);
    return { bytes, status, contentType };
  } catch (error) {
    const errorClass = error instanceof PenglaiError ? error.errorClass : "DELIVERY_TRANSIENT";
    log(errorClass, 0);
    throw error;
  }
}

export async function readBoundedJson(input: ReadBoundedResponseInput): Promise<{
  value: unknown;
  bytes: Buffer;
  status: number;
}> {
  const read = await readBoundedResponse({
    ...input,
    mimeAllowed: input.mimeAllowed ?? jsonMimeAllowed,
  });
  try {
    return { value: JSON.parse(read.bytes.toString("utf8")), bytes: read.bytes, status: read.status };
  } catch {
    throw new PenglaiError("DELIVERY_TRANSIENT", JSON_CODE);
  }
}
