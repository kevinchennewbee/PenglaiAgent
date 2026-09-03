import { createDecipheriv, randomBytes } from "node:crypto";

const PORTAL_ORIGIN = "https://q.qq.com";
const CREATE_PATH = "/lite/create_bind_task";
const POLL_PATH = "/lite/poll_bind_result";
const CONNECT_PATH = "/qqbot/openclaw/connect.html";
const MAX_RESPONSE_BYTES = 64 * 1024;

export interface QqOnboardCredentials {
  appId: string;
  clientSecret: string;
  userOpenid?: string;
}

export interface QqOnboardCallbacks {
  onQrReady(url: string): void;
  onSuccess(credentials: QqOnboardCredentials): void;
  onFailure(error: unknown): void;
}

export interface QqOnboardOptions {
  source?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  requestTimeoutMs?: number;
  fetchFn?: typeof fetch;
}

interface PortalEnvelope {
  retcode?: unknown;
  msg?: unknown;
  data?: Record<string, unknown>;
}

function asRequiredString(value: unknown, label: string): string {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!text || text.length > 8_192) throw new Error(`QQ_ONBOARD_${label}`);
  return text;
}

function apiError(envelope: PortalEnvelope, operation: string): never {
  const code = Number(envelope.retcode);
  const message = typeof envelope.msg === "string" ? envelope.msg.slice(0, 240) : operation;
  throw new Error(`QQ_ONBOARD_API:${operation}:${Number.isFinite(code) ? code : "invalid"}:${message}`);
}

function requestSignal(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; close(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("QQ_ONBOARD_REQUEST_TIMEOUT")), timeoutMs);
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    },
  };
}
async function postPortal(
  fetchFn: typeof fetch,
  path: string,
  body: Record<string, string>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<PortalEnvelope> {
  const scoped = requestSignal(signal, timeoutMs);
  try {
    const response = await fetchFn(`${PORTAL_ORIGIN}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "PenglaiAgent/0.5.10 QQBotOnboard",
      },
      body: JSON.stringify(body),
      redirect: "follow",
      signal: scoped.signal,
    });
    if (!response.ok) throw new Error(`QQ_ONBOARD_HTTP:${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("QQ_ONBOARD_RESPONSE_TOO_LARGE");
    const parsed = JSON.parse(text) as PortalEnvelope;
    if (!parsed || typeof parsed !== "object") throw new Error("QQ_ONBOARD_RESPONSE");
    return parsed;
  } finally {
    scoped.close();
  }
}

function decryptClientSecret(encryptedBase64: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, "base64");
  const encrypted = Buffer.from(encryptedBase64, "base64");
  if (key.length !== 32 || encrypted.length < 12 + 16 + 1) throw new Error("QQ_ONBOARD_CIPHERTEXT");
  const iv = encrypted.subarray(0, 12);
  const ciphertext = encrypted.subarray(12, -16);
  const authTag = encrypted.subarray(-16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const secret = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8").trim();
  if (!secret || secret.length > 8_192) throw new Error("QQ_ONBOARD_SECRET");
  return secret;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      reject(signal.reason);
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}

/**
 * Selective TypeScript rewrite of Tencent qqbot-agent-sdk's MIT onboard flow.
 * It keeps the AES-256-GCM secret local, exposes only the official QR URL,
 * bounds all network reads/timeouts, and never prints credentials or QR data.
 */
export function startQqOnboard(callbacks: QqOnboardCallbacks, options: QqOnboardOptions = {}): () => void {
  const controller = new AbortController();
  const fetchFn = options.fetchFn ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const pollTimeoutMs = options.pollTimeoutMs ?? 300_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const source = (options.source ?? "penglai-im").trim().slice(0, 80);
  let cancelled = false;
  void (async () => {
    const keyBase64 = randomBytes(32).toString("base64");
    const created = await postPortal(fetchFn, CREATE_PATH, { key: keyBase64 }, controller.signal, requestTimeoutMs);
    if (Number(created.retcode) !== 0) apiError(created, "create");
    const taskId = asRequiredString(created.data?.task_id, "TASK_ID");
    const query = new URLSearchParams({ task_id: taskId, _wv: "2" });
    if (source) query.set("source", source);
    callbacks.onQrReady(`${PORTAL_ORIGIN}${CONNECT_PATH}?${query.toString()}`);
    const deadline = Date.now() + pollTimeoutMs;
    while (Date.now() < deadline) {
      const polled = await postPortal(fetchFn, POLL_PATH, { task_id: taskId }, controller.signal, requestTimeoutMs);
      if (Number(polled.retcode) !== 0) apiError(polled, "poll");
      const status = Number(polled.data?.status);
      if (status === 2) {
        const appId = asRequiredString(polled.data?.bot_appid, "APP_ID");
        const encrypted = asRequiredString(polled.data?.bot_encrypt_secret, "ENCRYPTED_SECRET");
        const userOpenid = typeof polled.data?.user_openid === "string" ? polled.data.user_openid.trim() : "";
        callbacks.onSuccess({
          appId,
          clientSecret: decryptClientSecret(encrypted, keyBase64),
          ...(userOpenid ? { userOpenid } : {}),
        });
        return;
      }
      if (status === 3) throw new Error("QQ_ONBOARD_EXPIRED");
      if (status !== 0 && status !== 1) throw new Error("QQ_ONBOARD_STATUS");
      await wait(pollIntervalMs, controller.signal);
    }
    throw new Error("QQ_ONBOARD_TIMEOUT");
  })().catch((error) => {
    if (!cancelled) callbacks.onFailure(error);
  });
  return () => {
    cancelled = true;
    controller.abort(new Error("QQ_ONBOARD_CANCELLED"));
  };
}
