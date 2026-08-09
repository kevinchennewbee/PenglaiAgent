/**
 * Minimal WeChat iLink long-poll supervisor.
 * Goal: prove token liveness + receive updates (chat product bridge still thin).
 * Not a second agent core — Host owns the process; Desktop only shows state.
 */

import type { WechatToken } from "./ilink.js";
import { loadWechatToken, saveWechatToken } from "./ilink.js";

const ILINK_BASE = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "2.2.0";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type WechatRuntimeState =
  | "stopped"
  | "starting"
  | "live"
  | "reconnecting"
  | "error"
  | "no_token";

export interface WechatRuntimeStatus {
  state: WechatRuntimeState;
  botId: string | null;
  lastError: string | null;
  lastEventAt: number | null;
  updates: number;
}

type LogFn = (line: string) => void;

export class WechatRuntime {
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private state: WechatRuntimeState = "stopped";
  private lastError: string | null = null;
  private lastEventAt: number | null = null;
  private updates = 0;
  private botId: string | null = null;
  private token: WechatToken | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly log: LogFn = () => undefined,
  ) {}

  status(): WechatRuntimeStatus {
    return {
      state: this.state,
      botId: this.botId ?? this.token?.botId ?? null,
      lastError: this.lastError,
      lastEventAt: this.lastEventAt,
      updates: this.updates,
    };
  }

  start(): WechatRuntimeStatus {
    const token = loadWechatToken(this.dataDir);
    if (!token?.botToken) {
      this.state = "no_token";
      this.lastError = "no wechat token; scan to bind first";
      return this.status();
    }
    this.token = token;
    this.botId = token.botId || null;
    this.stopped = false;
    this.state = "starting";
    this.lastError = null;
    this.schedule(0);
    this.log(`wechat runtime start botId=${this.botId ?? "?"}`);
    return this.status();
  }

  stop(): WechatRuntimeStatus {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state = "stopped";
    this.log("wechat runtime stopped");
    return this.status();
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.tick();
    }, ms);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped || !this.token?.botToken) return;
    try {
      const body = {
        get_updates_buf: this.token.getUpdatesBuf ?? "",
        base_info: { channel_version: CHANNEL_VERSION },
      };
      const response = await fetch(`${ILINK_BASE}/ilink/bot/getupdates`, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token.botToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(40_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as Record<string, unknown>;
      if (data.errcode && Number(data.errcode) !== 0) {
        if (Number(data.errcode) === -14) {
          this.state = "error";
          this.lastError = "session expired; re-scan QR";
          this.schedule(15_000);
          return;
        }
        throw new Error(`errcode ${String(data.errcode)} ${String(data.errmsg ?? "")}`);
      }
      const buf = typeof data.get_updates_buf === "string" ? data.get_updates_buf : "";
      if (buf && this.token) {
        this.token = { ...this.token, getUpdatesBuf: buf };
        saveWechatToken(this.dataDir, this.token);
      }
      const msgs = Array.isArray(data.msgs) ? data.msgs : [];
      if (msgs.length > 0) {
        this.updates += msgs.length;
        this.lastEventAt = Date.now();
        this.log(`wechat runtime received ${msgs.length} update(s)`);
        // Product bridge (map to conversation.prompt) is next slice; for now
        // liveness + counters are honest Host state for Desktop.
      }
      this.state = "live";
      this.lastError = null;
      this.schedule(500);
    } catch (error) {
      this.state = "reconnecting";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.schedule(5_000);
    }
  }
}
