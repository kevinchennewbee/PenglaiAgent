import { PenglaiError } from "@penglai/contracts";

const DEFAULT_BASE = "https://oapi.dingtalk.com";
const SOURCE = "PENGLAI_IM";

export interface DingTalkQrSession {
  deviceCode: string;
  verificationUrl: string;
  expiresAt: number;
  pollIntervalMs: number;
}

export interface DingTalkQrPoll {
  status: "WAITING" | "SUCCESS" | "FAIL" | "EXPIRED" | "UNKNOWN";
  clientId?: string;
  clientSecret?: string;
}

function httpsDingtalk(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PenglaiError("INVALID_INPUT", "DINGTALK_BASE_URL");
  }
  const host = parsed.hostname === "dingtalk.com" || parsed.hostname.endsWith(".dingtalk.com");
  if (parsed.protocol !== "https:" || parsed.port || !host || parsed.username || parsed.password) {
    throw new PenglaiError("SECURITY_POLICY", "DINGTALK_BASE_URL");
  }
  return parsed.origin;
}

/**
 * Official DingTalk device-registration QR. Rewritten for Penglai; does not
 * copy DSH-IM source. Credentials never leave the host adapter.
 */
export class DingTalkDeviceAuth {
  constructor(
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly baseUrl = DEFAULT_BASE,
  ) {}

  async start(signal?: AbortSignal): Promise<DingTalkQrSession> {
    const base = httpsDingtalk(this.baseUrl);
    const initialized = await this.post(`${base}/app/registration/init`, { source: SOURCE }, signal);
    const nonce = String(initialized.nonce ?? "").trim();
    if (!nonce) throw new PenglaiError("DELIVERY_TRANSIENT", "DINGTALK_QR_NONCE");
    const begun = await this.post(`${base}/app/registration/begin`, { nonce }, signal);
    const deviceCode = String(begun.device_code ?? "").trim();
    const verificationUrl = String(begun.verification_uri_complete ?? "").trim();
    if (!deviceCode || !verificationUrl) throw new PenglaiError("DELIVERY_TRANSIENT", "DINGTALK_QR_INCOMPLETE");
    return {
      deviceCode,
      verificationUrl,
      expiresAt: Date.now() + Number(begun.expires_in ?? 7200) * 1000,
      pollIntervalMs: Number(begun.interval ?? 5) * 1000,
    };
  }

  async poll(deviceCode: string, signal?: AbortSignal): Promise<DingTalkQrPoll> {
    const base = httpsDingtalk(this.baseUrl);
    const response = await this.post(`${base}/app/registration/poll`, { device_code: deviceCode }, signal);
    const raw = String(response.status ?? "UNKNOWN").toUpperCase();
    const status = (["WAITING", "SUCCESS", "FAIL", "EXPIRED"].includes(raw) ? raw : "UNKNOWN") as DingTalkQrPoll["status"];
    const clientId = String(response.client_id ?? "").trim() || undefined;
    const clientSecret = String(response.client_secret ?? "").trim() || undefined;
    return { status, ...(clientId ? { clientId } : {}), ...(clientSecret ? { clientSecret } : {}) };
  }

  private async post(url: string, body: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new PenglaiError("DELIVERY_TRANSIENT", "DINGTALK_QR_HTTP");
    const value = (await response.json()) as Record<string, unknown>;
    if (Number(value.errcode) !== 0) throw new PenglaiError("DELIVERY_TRANSIENT", "DINGTALK_QR_API");
    return value;
  }
}
