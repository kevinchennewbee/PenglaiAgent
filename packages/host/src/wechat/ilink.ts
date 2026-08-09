/**
 * WeChat iLink bot transport (Host-native).
 *
 * Ported from 0.3 frontends/wechatapp.py + Hermes gateway/platforms/weixin.py:
 *   - QR login: get_bot_qrcode → poll get_qrcode_status → bot_token / ilink_bot_id
 *   - Long-poll getupdates / sendmessage (runtime can attach later)
 *
 * Secrets live under the Penglai data dir — never mykey.py.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWritePrivateJson, readPrivateTextFile } from "../security/private-file.js";

const ILINK_BASE = "https://ilinkai.weixin.qq.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CHANNEL_VERSION = "2.2.0";
const MAX_WECHAT_TOKEN_FILE_BYTES = 1024 * 1024;

export interface WechatToken {
  botToken: string;
  botId: string;
  loginTime?: string;
  getUpdatesBuf?: string;
}

export interface WechatBindSession {
  sessionId: string;
  qrcodeId: string;
  qrUrl: string;
  status: "pending" | "scanned" | "confirmed" | "expired" | "error";
  token?: WechatToken;
  error?: string;
  createdAt: number;
}

const bindSessions = new Map<string, WechatBindSession>();

export function wechatTokenPath(dataDir: string): string {
  return path.join(dataDir, "wechat-token.json");
}

export function loadWechatToken(dataDir: string): WechatToken | null {
  try {
    const file = wechatTokenPath(dataDir);
    const raw = JSON.parse(readPrivateTextFile(file, MAX_WECHAT_TOKEN_FILE_BYTES, true).text) as Record<
      string,
      unknown
    >;
    const botToken =
      (typeof raw.botToken === "string" && raw.botToken) ||
      (typeof raw.bot_token === "string" && raw.bot_token) ||
      "";
    const botId =
      (typeof raw.botId === "string" && raw.botId) ||
      (typeof raw.ilink_bot_id === "string" && raw.ilink_bot_id) ||
      "";
    if (!botToken) return null;
    return {
      botToken,
      botId,
      loginTime: typeof raw.loginTime === "string" ? raw.loginTime : undefined,
      getUpdatesBuf:
        typeof raw.getUpdatesBuf === "string"
          ? raw.getUpdatesBuf
          : typeof raw.get_updates_buf === "string"
            ? raw.get_updates_buf
            : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Private config")) throw error;
    return null;
  }
}

export function saveWechatToken(dataDir: string, token: WechatToken): string {
  if (!token.botToken.trim() || token.botToken.length > 16_384) {
    throw new Error("WeChat bot token is empty or too long");
  }
  const file = wechatTokenPath(dataDir);
  const payload = {
    schemaVersion: 1,
    botToken: token.botToken,
    botId: token.botId,
    loginTime: token.loginTime ?? new Date().toISOString(),
    getUpdatesBuf: token.getUpdatesBuf ?? "",
  };
  atomicWritePrivateJson(file, payload, MAX_WECHAT_TOKEN_FILE_BYTES);
  return file;
}

export function clearWechatToken(dataDir: string): void {
  try {
    fs.unlinkSync(wechatTokenPath(dataDir));
  } catch {
    /* ignore */
  }
}

async function ilinkGet(pathname: string, query: Record<string, string>): Promise<Record<string, unknown>> {
  const url = new URL(pathname, ILINK_BASE);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`iLink HTTP ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

function sessionId(): string {
  return `wxbind_${crypto.randomUUID()}`;
}

/** Start a QR bind session for personal WeChat iLink bot. */
export async function startWechatQrBind(): Promise<WechatBindSession> {
  let lastError = "unknown";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const data = await ilinkGet("ilink/bot/get_bot_qrcode", { bot_type: "3" });
      const qrcodeId = typeof data.qrcode === "string" ? data.qrcode : "";
      const qrUrl = typeof data.qrcode_img_content === "string" ? data.qrcode_img_content : "";
      if (qrcodeId && qrUrl) {
        const session: WechatBindSession = {
          sessionId: sessionId(),
          qrcodeId,
          qrUrl,
          status: "pending",
          createdAt: Date.now(),
        };
        bindSessions.set(session.sessionId, session);
        return session;
      }
      lastError = `qr not ready ret=${String(data.ret ?? "")}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 400));
  }
  throw new Error(`获取微信二维码失败：${lastError}`);
}

/** Poll QR status; on confirmed, returns session with token. */
export async function pollWechatQrBind(sessionIdValue: string): Promise<WechatBindSession> {
  const session = bindSessions.get(sessionIdValue);
  if (!session) {
    return {
      sessionId: sessionIdValue,
      qrcodeId: "",
      qrUrl: "",
      status: "error",
      error: "unknown bind session",
      createdAt: Date.now(),
    };
  }
  if (session.status === "confirmed" || session.status === "expired" || session.status === "error") {
    return session;
  }
  try {
    const data = await ilinkGet("ilink/bot/get_qrcode_status", { qrcode: session.qrcodeId });
    const st = typeof data.status === "string" ? data.status : "";
    if (st === "confirmed") {
      session.status = "confirmed";
      session.token = {
        botToken: typeof data.bot_token === "string" ? data.bot_token : "",
        botId: typeof data.ilink_bot_id === "string" ? data.ilink_bot_id : "",
        loginTime: new Date().toISOString(),
      };
      if (!session.token.botToken) {
        session.status = "error";
        session.error = "扫码成功但未返回 bot_token";
      }
    } else if (st === "expired") {
      session.status = "expired";
      session.error = "二维码已过期";
    } else if (st === "wait" || st === "scanned" || st === "scaned") {
      session.status = st.includes("scan") ? "scanned" : "pending";
    }
  } catch (error) {
    // Transient network blips — keep pending.
    session.error = error instanceof Error ? error.message : String(error);
  }
  bindSessions.set(sessionIdValue, session);
  return session;
}

export function dropWechatBindSession(sessionIdValue: string): void {
  bindSessions.delete(sessionIdValue);
}

/** Lightweight credential probe (does not start a long-poll loop). */
export async function probeWechatToken(token: WechatToken): Promise<{ ok: boolean; detail: string }> {
  if (!token.botToken) return { ok: false, detail: "missing botToken" };
  try {
    const response = await fetch(`${ILINK_BASE}/ilink/bot/getconfig`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.botToken}`,
      },
      body: JSON.stringify({
        base_info: { channel_version: CHANNEL_VERSION },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
    const data = (await response.json()) as Record<string, unknown>;
    if (data.errcode && data.errcode !== 0) {
      return { ok: false, detail: `errcode ${String(data.errcode)} ${String(data.errmsg ?? "")}` };
    }
    return { ok: true, detail: "token accepted by iLink" };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
