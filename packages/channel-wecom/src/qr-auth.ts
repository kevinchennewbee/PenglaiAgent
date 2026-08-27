import { PenglaiError } from "@penglai/contracts";

const GENERATE_URL = "https://work.weixin.qq.com/ai/qc/generate";
const POLL_URL = "https://work.weixin.qq.com/ai/qc/query_result";
const QR_TTL_MS = 5 * 60_000;

function platform(): number {
  if (process.platform === "win32") return 2;
  if (process.platform === "linux") return 3;
  return 1;
}

function workWeixinHttps(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && url.hostname === "work.weixin.qq.com") return url.href;
  } catch {
    /* ignore */
  }
  return undefined;
}

/** Official WeCom intelligent-bot QR. Rewritten for Penglai; host-only. */
export class WeComQrAuth {
  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch) {}

  async start(signal?: AbortSignal): Promise<{ scode: string; verificationUrl: string; expiresAt: number }> {
    const url = new URL(GENERATE_URL);
    url.searchParams.set("source", "penglai-im");
    url.searchParams.set("plat", String(platform()));
    const body = (await this.get(url, signal)) as { data?: { scode?: string; auth_url?: string } };
    const scode = String(body.data?.scode ?? "").trim();
    const verificationUrl = workWeixinHttps(String(body.data?.auth_url ?? ""));
    if (!scode || !verificationUrl) throw new PenglaiError("DELIVERY_TRANSIENT", "WECOM_QR_INCOMPLETE");
    return { scode, verificationUrl, expiresAt: Date.now() + QR_TTL_MS };
  }

  async poll(scode: string, signal?: AbortSignal): Promise<{ status: "waiting" | "success" | "expired" | "failed"; botId?: string; secret?: string }> {
    const url = new URL(POLL_URL);
    url.searchParams.set("scode", scode);
    const body = (await this.get(url, signal)) as {
      data?: { status?: string; bot_info?: { botid?: string; secret?: string } };
    };
    const state = String(body.data?.status ?? "").toLowerCase();
    if (state === "success") {
      const botId = String(body.data?.bot_info?.botid ?? "").trim();
      const secret = String(body.data?.bot_info?.secret ?? "").trim();
      if (!botId || !secret) throw new PenglaiError("DELIVERY_TRANSIENT", "WECOM_QR_CREDS");
      return { status: "success", botId, secret };
    }
    if (state === "expired" || state === "timeout") return { status: "expired" };
    if (state === "fail" || state === "failed" || state === "error") return { status: "failed" };
    return { status: "waiting" };
  }

  private async get(url: URL, signal?: AbortSignal): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: signal ?? AbortSignal.timeout(10_000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new PenglaiError("DELIVERY_TRANSIENT", "WECOM_QR_HTTP");
    return response.json();
  }
}
