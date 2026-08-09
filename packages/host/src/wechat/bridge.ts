/**
 * WeChat iLink → Penglai conversation bridge.
 *
 * Inbound text messages (allowlisted identities) become conversation.prompt;
 * assistant replies are sent back via ilink/bot/sendmessage. Host owns the
 * process; Desktop only shows channel state.
 */

import type { Conversation } from "@penglai/protocol";
import type { ProductStore } from "../storage/product-store.js";
import type { ConversationExecutor } from "../conversation-executor.js";
import type { WechatToken } from "./ilink.js";
import { loadWechatToken, saveWechatToken } from "./ilink.js";

const ILINK_BASE = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "2.2.0";
/** Per-inbound-message ceiling so one slow prompt never stalls the long-poll. */
const WECHAT_INBOUND_TIMEOUT_MS = 3 * 60_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type WechatBridgeState =
  | "stopped"
  | "starting"
  | "live"
  | "reconnecting"
  | "error"
  | "no_token";

export interface WechatBridgeStatus {
  state: WechatBridgeState;
  botId: string | null;
  lastError: string | null;
  lastEventAt: number | null;
  updates: number;
  bridged: number;
  denied: number;
}

export interface WechatBridgeDeps {
  dataDir: string;
  store: ProductStore;
  conversationExecutor: ConversationExecutor;
  /** Resolve or create a conversation for this WeChat user/chat. */
  ensureConversation: (input: {
    channel: "wechat";
    chatId: string;
    channelUserId: string;
    title: string;
  }) => Conversation;
  resolveDefaultProfileId: () => string | null;
  log?: (line: string) => void;
  publish?: (channelId: string, event: unknown) => void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractText(msg: Record<string, unknown>): string {
  const items = Array.isArray(msg.item_list) ? msg.item_list : [];
  const parts: string[] = [];
  for (const raw of items) {
    if (!isObject(raw)) continue;
    const textItem = isObject(raw.text_item) ? raw.text_item : null;
    if (textItem && typeof textItem.text === "string" && textItem.text.trim()) {
      parts.push(textItem.text.trim());
      continue;
    }
    if (typeof raw.text === "string" && raw.text.trim()) {
      parts.push(raw.text.trim());
    }
  }
  if (parts.length) return parts.join("\n");
  if (typeof msg.text === "string") return msg.text.trim();
  return "";
}

function clientId(): string {
  return `penglai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class WechatBridge {
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private state: WechatBridgeState = "stopped";
  private lastError: string | null = null;
  private lastEventAt: number | null = null;
  private updates = 0;
  private bridged = 0;
  private denied = 0;
  private botId: string | null = null;
  private token: WechatToken | null = null;
  private readonly seen = new Set<string>();

  constructor(private readonly deps: WechatBridgeDeps) {}

  status(): WechatBridgeStatus {
    return {
      state: this.state,
      botId: this.botId ?? this.token?.botId ?? null,
      lastError: this.lastError,
      lastEventAt: this.lastEventAt,
      updates: this.updates,
      bridged: this.bridged,
      denied: this.denied,
    };
  }

  start(): WechatBridgeStatus {
    const token = loadWechatToken(this.deps.dataDir);
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
    this.deps.log?.(`wechat bridge start botId=${this.botId ?? "?"}`);
    return this.status();
  }

  stop(): WechatBridgeStatus {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state = "stopped";
    this.deps.log?.("wechat bridge stopped");
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
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
        saveWechatToken(this.deps.dataDir, this.token);
      }
      const msgs = Array.isArray(data.msgs) ? data.msgs : [];
      if (msgs.length > 0) {
        this.updates += msgs.length;
        this.lastEventAt = Date.now();
        for (const raw of msgs) {
          if (isObject(raw)) {
            // 每条入站消息单独 bounded：统一 episode 可能在长任务上卡住，
            // 串行 await 会把整个长轮询 tick 停摆（get_updates_buf 不再推进、
            // 消息堆积）。超时后本轮先跳过，下个 tick 重试。
            await Promise.race([
              this.handleInbound(raw),
              new Promise((resolve) => setTimeout(resolve, WECHAT_INBOUND_TIMEOUT_MS)),
            ]);
          }
        }
      }
      this.state = "live";
      this.lastError = null;
      // 无论入站处理是否超时/失败都恢复轮询节奏（schedule 放在 catch 外）。
      this.schedule(500);
    } catch (error) {
      this.state = "reconnecting";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.schedule(5_000);
    }
  }

  private async handleInbound(msg: Record<string, unknown>): Promise<void> {
    const from =
      (typeof msg.from_user_id === "string" && msg.from_user_id) ||
      (typeof msg.ilink_user_id === "string" && msg.ilink_user_id) ||
      "";
    if (!from) return;
    // Skip bot self messages when possible.
    if (this.botId && from === this.botId) return;

    const dedupe =
      (typeof msg.msg_id === "string" && msg.msg_id) ||
      (typeof msg.client_id === "string" && msg.client_id) ||
      `${from}:${String(msg.create_time_ms ?? msg.create_time ?? "")}:${extractText(msg).slice(0, 40)}`;
    if (this.seen.has(dedupe)) return;
    this.seen.add(dedupe);
    if (this.seen.size > 2_000) {
      const drop = [...this.seen].slice(0, 500);
      for (const key of drop) this.seen.delete(key);
    }

    const text = extractText(msg);
    if (!text) return;

    const identity = this.deps.store.getChannelIdentity("wechat", from);
    if (!identity) {
      this.denied += 1;
      this.deps.log?.(`wechat deny non-allowlisted user ${from.slice(-8)}`);
      await this.sendText(from, "未授权：请先在蓬莱桌面「渠道」把你的微信用户加入白名单。", msg);
      return;
    }

    try {
      const conversation = this.deps.ensureConversation({
        channel: "wechat",
        chatId: from,
        channelUserId: from,
        title: `微信 · ${identity.identity || from.slice(-6)}`,
      });
      this.deps.publish?.(conversation.id, {
        event: "conversation.channel.inbound",
        conversationId: conversation.id,
        channel: "wechat",
        channelUserId: from,
        text,
      });
      const result = await this.deps.conversationExecutor.prompt({
        conversationId: conversation.id,
        text,
        permissionMode: "auto_edit",
        delivery: "queue",
      });
      const reply = (result.text || "").trim();
      if (reply) {
        await this.sendText(from, reply.slice(0, 3500), msg);
      }
      this.bridged += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.log?.(`wechat bridge prompt failed: ${message}`);
      await this.sendText(from, `处理失败：${message.slice(0, 500)}`, msg);
    }
  }

  private async sendText(
    toUserId: string,
    text: string,
    contextMsg?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.token?.botToken) return;
    const contextToken =
      (contextMsg && typeof contextMsg.context_token === "string" && contextMsg.context_token) ||
      "";
    const msg: Record<string, unknown> = {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId(),
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text } }],
    };
    if (contextToken) msg.context_token = contextToken;
    try {
      await fetch(`${ILINK_BASE}/ilink/bot/sendmessage`, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token.botToken}`,
        },
        body: JSON.stringify({
          msg,
          base_info: { channel_version: CHANNEL_VERSION },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.deps.log?.(
        `wechat send failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Host-owned proactive delivery (companion) through the existing bridge. */
  async sendProactiveText(toUserId: string, text: string): Promise<void> {
    await this.sendText(toUserId, text);
  }
}
