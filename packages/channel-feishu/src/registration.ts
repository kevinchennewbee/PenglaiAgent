import { gzipSync } from "node:zlib";
import { PenglaiError, isRecord } from "@penglai/contracts";
import { FEISHU_MIN_SCOPES, FEISHU_RECEIVE_EVENT } from "./official.js";
import { renderQrPngDataUrl } from "./qr-image.js";

export const FEISHU_REGISTRATION_ORIGIN = "https://accounts.feishu.cn";
export const FEISHU_REGISTRATION_PATH = "/oauth/v1/app/registration";
export const LARK_REGISTRATION_ORIGIN = "https://accounts.larksuite.com";

export type FeishuQrStatus = "wait" | "confirmed" | "denied" | "expired" | "failed";

export interface FeishuRegistrationFetch {
  (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface FeishuQrStart {
  challengeId: string;
  ttlMs: number;
  intervalMs: number;
  qrImageRef: string;
  status: "wait";
}

export interface FeishuQrPoll {
  status: FeishuQrStatus;
  appId?: string;
  appSecret?: string;
}

export interface FeishuQrCredentials {
  appId: string;
  appSecret: string;
  ownerOpenId?: string;
}

interface Session {
  deviceCode: string;
  expiresAt: number;
  intervalMs: number;
  origin: string;
  status: FeishuQrStatus;
  appId?: string;
  appSecret?: string;
  ownerOpenId?: string;
}

export function feishuOwnerOpenIdFromUserInfo(info: unknown): string | undefined {
  if (!isRecord(info)) return undefined;
  const openId = info.open_id;
  return typeof openId === "string" && openId.trim().length >= 3 ? openId.trim() : undefined;
}

function encodeAddons(addons: unknown): string {
  return gzipSync(Buffer.from(JSON.stringify(addons), "utf8"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function penglaiFeishuAddons(): string {
  return encodeAddons({
    preset: false,
    scopes: { tenant: [...FEISHU_MIN_SCOPES] },
    events: { items: { tenant: [FEISHU_RECEIVE_EVENT] } },
  });
}

export function decorateFeishuQrUrl(raw: string): string {
  const url = new URL(raw);
  url.searchParams.set("from", "sdk");
  url.searchParams.set("source", "node-sdk/penglai");
  url.searchParams.set("tp", "sdk");
  url.searchParams.set("createOnly", "true");
  url.searchParams.set("name", "蓬莱 Penglai");
  url.searchParams.set("addons", penglaiFeishuAddons());
  return url.toString();
}

export class FeishuAppRegistration {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly fetchImpl: FeishuRegistrationFetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async begin(): Promise<FeishuQrStart> {
    const init = await this.post(FEISHU_REGISTRATION_ORIGIN, { action: "init" });
    const methods = Array.isArray(init.supported_auth_methods) ? init.supported_auth_methods : [];
    if (!methods.includes("client_secret")) {
      throw new PenglaiError("DSH_UNAVAILABLE", "feishu registration missing client_secret");
    }
    const begin = await this.post(FEISHU_REGISTRATION_ORIGIN, {
      action: "begin",
      archetype: "PersonalAgent",
      auth_method: "client_secret",
      request_user_info: "open_id",
    });
    const deviceCode = typeof begin.device_code === "string" ? begin.device_code : "";
    const uri = typeof begin.verification_uri_complete === "string" ? begin.verification_uri_complete : "";
    if (!deviceCode || !uri) throw new PenglaiError("INVALID_INPUT", "feishu qr missing");
    const ttlMs = Math.min(Number(begin.expires_in) || 600, 3600) * 1000;
    const intervalMs = Math.max(Number(begin.interval) || 5, 2) * 1000;
    const challengeId = `fsqr_${this.now().toString(36)}_${this.sessions.size}`;
    this.sessions.set(challengeId, {
      deviceCode,
      expiresAt: this.now() + ttlMs,
      intervalMs,
      origin: FEISHU_REGISTRATION_ORIGIN,
      status: "wait",
    });
    return {
      challengeId,
      ttlMs,
      intervalMs,
      qrImageRef: await renderQrPngDataUrl(decorateFeishuQrUrl(uri)),
      status: "wait",
    };
  }

  async poll(challengeId: string): Promise<FeishuQrPoll> {
    const session = this.sessions.get(challengeId);
    if (!session) return { status: "failed" };
    if (session.status !== "wait") {
      return this.view(session);
    }
    if (this.now() > session.expiresAt) {
      session.status = "expired";
      return { status: "expired" };
    }
    const raw = await this.post(session.origin, { action: "poll", device_code: session.deviceCode });
    if (raw.user_info && isRecord(raw.user_info) && raw.user_info.tenant_brand === "lark") {
      session.origin = LARK_REGISTRATION_ORIGIN;
    }
    const ownerOpenId = feishuOwnerOpenIdFromUserInfo(raw.user_info);
    if (ownerOpenId) session.ownerOpenId = ownerOpenId;
    if (typeof raw.client_id === "string" && typeof raw.client_secret === "string") {
      session.status = "confirmed";
      session.appId = raw.client_id;
      session.appSecret = raw.client_secret;
      return this.view(session);
    }
    if (raw.error === "access_denied") session.status = "denied";
    else if (raw.error === "expired_token") session.status = "expired";
    else if (raw.error && raw.error !== "authorization_pending" && raw.error !== "slow_down") {
      session.status = "failed";
    }
    return this.view(session);
  }

  takeConfirmed(challengeId: string): FeishuQrCredentials | undefined {
    const session = this.sessions.get(challengeId);
    if (session?.status !== "confirmed" || !session.appId || !session.appSecret) return undefined;
    const creds: FeishuQrCredentials = {
      appId: session.appId,
      appSecret: session.appSecret,
      ...(session.ownerOpenId ? { ownerOpenId: session.ownerOpenId } : {}),
    };
    this.sessions.delete(challengeId);
    return creds;
  }

  cancel(challengeId: string): void {
    this.sessions.delete(challengeId);
  }

  private view(session: Session): FeishuQrPoll {
    return {
      status: session.status,
      ...(session.status === "confirmed" && session.appId ? { appId: session.appId } : {}),
    };
  }

  private async post(origin: string, body: Record<string, string>): Promise<Record<string, unknown>> {
    let res: { ok: boolean; status: number; text(): Promise<string> };
    try {
      res = await this.fetchImpl(`${origin}${FEISHU_REGISTRATION_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PenglaiError("DELIVERY_TRANSIENT", "feishu registration network");
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PenglaiError("DELIVERY_TRANSIENT", "feishu registration json");
    }
    return isRecord(parsed) ? parsed : {};
  }
}
