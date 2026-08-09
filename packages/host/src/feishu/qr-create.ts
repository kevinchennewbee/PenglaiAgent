/**
 * Feishu one-click app registration (device-code QR).
 *
 * Port of 0.3 penglai_setup._feishu_qr_create:
 *   POST accounts.feishu.cn/oauth/v1/app/registration
 *   action=init → begin(PersonalAgent) → poll → client_id + client_secret
 *
 * Desktop/CLI can drive this then call channel.setup with the returned creds.
 */

const FS_REG = "https://accounts.feishu.cn/oauth/v1/app/registration";

export interface FeishuQrSession {
  sessionId: string;
  deviceCode: string;
  qrUrl: string;
  status: "pending" | "confirmed" | "denied" | "expired" | "error";
  appId?: string;
  appSecret?: string;
  error?: string;
  createdAt: number;
  expiresAt: number;
  intervalSec: number;
}

const sessions = new Map<string, FeishuQrSession>();

async function postForm(body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(FS_REG, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  // 4xx may still carry JSON (authorization_pending).
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`feishu registration non-JSON (HTTP ${response.status})`);
  }
}

function sid(): string {
  return `fsqr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function startFeishuQrCreate(): Promise<FeishuQrSession> {
  const init = await postForm({ action: "init" });
  const methods = (init.supported_auth_methods as string[] | undefined) ?? [];
  if (!methods.includes("client_secret")) {
    throw new Error("飞书注册端点不支持 client_secret 设备码流");
  }
  const begin = await postForm({
    action: "begin",
    archetype: "PersonalAgent",
    auth_method: "client_secret",
    request_user_info: "open_id",
  });
  const deviceCode = typeof begin.device_code === "string" ? begin.device_code : "";
  const qrUrl = typeof begin.verification_uri_complete === "string" ? begin.verification_uri_complete : "";
  if (!deviceCode || !qrUrl) {
    throw new Error("飞书 begin 未返回 device_code / verification_uri");
  }
  const expiresIn = Math.min(Number(begin.expires_in) || 600, 600);
  const intervalSec = Math.max(Number(begin.interval) || 5, 2);
  const session: FeishuQrSession = {
    sessionId: sid(),
    deviceCode,
    qrUrl,
    status: "pending",
    createdAt: Date.now(),
    expiresAt: Date.now() + expiresIn * 1000,
    intervalSec,
  };
  sessions.set(session.sessionId, session);
  return session;
}

export async function pollFeishuQrCreate(sessionId: string): Promise<FeishuQrSession> {
  const session = sessions.get(sessionId);
  if (!session) {
    return {
      sessionId,
      deviceCode: "",
      qrUrl: "",
      status: "error",
      error: "unknown session",
      createdAt: Date.now(),
      expiresAt: Date.now(),
      intervalSec: 5,
    };
  }
  if (session.status !== "pending") return session;
  if (Date.now() > session.expiresAt) {
    session.status = "expired";
    session.error = "二维码已过期";
    return session;
  }
  try {
    const res = await postForm({
      action: "poll",
      device_code: session.deviceCode,
      tp: "ob_app",
    });
    if (typeof res.client_id === "string" && typeof res.client_secret === "string") {
      session.status = "confirmed";
      session.appId = res.client_id;
      session.appSecret = res.client_secret;
    } else if (res.error === "access_denied") {
      session.status = "denied";
      session.error = "已在手机上取消";
    } else if (res.error === "expired_token") {
      session.status = "expired";
      session.error = "二维码已过期";
    }
  } catch (error) {
    session.error = error instanceof Error ? error.message : String(error);
  }
  sessions.set(sessionId, session);
  return session;
}
