/**
 * 飞书长连接客户端（WebSocket 事件订阅，裸 `ws` + 手写帧协议，零新增依赖）。
 *
 * 生命周期：端点发现（POST /callback/ws/endpoint）→ 连接 wss →
 * 心跳（CONTROL ping / pong，服务端可经 pong 下发 ClientConfig）→
 * DATA 帧分派（event → onEvent；card → onCardAction，返回值经 base64
 * 作为应答 data）→ 应答（同帧 + biz_rt + {"code":200}）→ 断线重连
 * （首次随机抖动 nonce 防惊群，之后按服务端 interval/count；致命错误
 * —— 鉴权/超限 —— 不重试）。
 *
 * 测试缝：fetchImpl / wsFactory / random / now / defaultClientConfig 全注入；
 * 集成测试用真实 loopback mock 飞书服务端打全协议。
 */

import { WebSocket as WsSocket } from "ws";
import {
  DEFAULT_CLIENT_CONFIG,
  ENDPOINT_URI,
  FRAME_TYPE_CONTROL,
  FRAME_TYPE_DATA,
  HEADER_MESSAGE_ID,
  HEADER_SEQ,
  HEADER_SUM,
  HEADER_TYPE,
  MESSAGE_TYPE_CARD,
  MESSAGE_TYPE_EVENT,
  MESSAGE_TYPE_PONG,
  buildAckFrame,
  buildEndpointRequestBody,
  buildNackFrame,
  buildPingFrame,
  decodeFrame,
  encodeFrame,
  headerValue,
  parseClientConfig,
  parseConnectionIds,
  parseEndpointResponse,
  parseEventEnvelope,
  FeishuProtocolError,
  type FeishuClientConfig,
  type FeishuEventEnvelope,
  type FeishuFrame,
} from "./protocol.js";

/** 最小 socket 抽象（ws.WebSocket 的子集，测试可注入假实现）。 */
export interface FeishuSocket {
  readonly readyState: number;
  on(event: "open" | "close" | "error" | "message", listener: (...args: never[]) => void): void;
  send(data: Buffer): void;
  close(): void;
}

export type FeishuWsState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  | "failed";

export interface FeishuWsClientOptions {
  appId: string;
  appSecret: string;
  domain: string;
  onEvent?: (envelope: FeishuEventEnvelope) => Promise<void>;
  /** 卡片回调；返回值作为应答 data（toast / 更新卡片），无返回则仅 ack。 */
  onCardAction?: (envelope: FeishuEventEnvelope) => Promise<unknown>;
  onStateChange?: (state: FeishuWsState) => void;
  fetchImpl?: typeof fetch;
  wsFactory?: (url: string) => FeishuSocket;
  random?: () => number;
  now?: () => number;
  log?: (line: string) => void;
  /** 服务端未下发 ClientConfig 时的本地默认（测试可调小心跳/重连参数）。 */
  defaultClientConfig?: FeishuClientConfig;
}

/** 致命错误（官方 SDK 语义：鉴权失败/被禁/连接数超限）— 不重连。 */
const FATAL_CODES = new Set([403, 1000040344, 1000040350]);

export class FeishuWsClient {
  private state: FeishuWsState = "idle";
  private socket: FeishuSocket | null = null;
  private config: FeishuClientConfig;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private attempts = 0;
  /** 合包缓冲：message_id → 已收分片（sum>1 的大消息）。 */
  private readonly parts = new Map<string, { sum: number; pieces: Map<number, Buffer>; firstSeenAt: number }>();
  private readonly fetchImpl: typeof fetch;
  private readonly wsFactory: (url: string) => FeishuSocket;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly options: FeishuWsClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.wsFactory =
      options.wsFactory ?? ((url) => new WsSocket(url) as unknown as FeishuSocket);
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
    this.config = options.defaultClientConfig ?? DEFAULT_CLIENT_CONFIG;
  }

  getState(): FeishuWsState {
    return this.state;
  }

  private setState(state: FeishuWsState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }

  /** 启动（幂等）：进入连接循环；致命错误转 failed 并抛出。 */
  async start(): Promise<void> {
    if (this.state !== "idle" && this.state !== "closed" && this.state !== "failed") {
      return;
    }
    this.stopped = false;
    this.attempts = 0;
    await this.connect();
  }

  /** 停止：清计时器、关 socket、不再重连。 */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
    this.setState("closed");
  }

  private clearTimers(): void {
    if (this.pingTimer) clearTimeout(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
  }

  // ── 连接 ─────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    this.setState(this.attempts === 0 ? "connecting" : "reconnecting");
    let url: string;
    try {
      const res = await this.fetchImpl(
        `${this.options.domain.replace(/\/+$/, "")}${ENDPOINT_URI}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8", locale: "zh" },
          body: buildEndpointRequestBody(this.options.appId, this.options.appSecret),
        },
      );
      const body = (await res.json().catch(() => null)) as {
        code?: number;
        msg?: string;
      } | null;
      if (!res.ok) {
        throw new FeishuProtocolError(
          `endpoint discovery http ${res.status}: ${body?.msg ?? ""}`,
        );
      }
      const parsed = parseEndpointResponse(body);
      url = parsed.url;
      this.config = parsed.clientConfig;
    } catch (error) {
      this.handleConnectFailure(error);
      return;
    }

    const { serviceId, deviceId } = parseConnectionIds(url);
    await new Promise<void>((resolve) => {
      const socket = this.wsFactory(url);
      this.socket = socket;
      let opened = false;
      socket.on("open", () => {
        opened = true;
        this.attempts = 0;
        this.setState("connected");
        this.log(`feishu ws connected (device ${deviceId || "?"}, service ${serviceId})`);
        this.schedulePing(serviceId);
        resolve();
      });
      socket.on("message", (data: Buffer) => {
        void this.handleFrame(data, serviceId);
      });
      socket.on("close", () => {
        if (this.socket === socket) this.socket = null;
        if (this.pingTimer) clearTimeout(this.pingTimer);
        this.pingTimer = null;
        if (!opened) resolve(); // 握手即失败：走重连
        if (!this.stopped) void this.scheduleReconnect();
      });
      socket.on("error", (error: Error) => {
        this.log(`feishu ws error: ${error.message}`);
        // close 事件随后到来，统一在那里走重连。
        if (!opened) resolve();
      });
    });
  }

  private handleConnectFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.log(`feishu endpoint discovery failed: ${message}`);
    const codeMatch = /code=(\d+)/.exec(message);
    const code = codeMatch ? Number(codeMatch[1]) : null;
    // Fatal when the payload carries a fatal code OR the transport itself
    // rejected us (403 / 401): a permanent auth failure must converge to
    // `failed`, not spin in an infinite reconnect loop.
    const httpStatus = /endpoint discovery http (\d+)/.exec(message);
    const status = httpStatus ? Number(httpStatus[1]) : null;
    const fatal =
      (code !== null && FATAL_CODES.has(code)) ||
      (status !== null && (status === 401 || status === 403));
    if (fatal) {
      this.setState("failed");
      return;
    }
    void this.scheduleReconnect();
  }

  // ── 心跳 / 重连 ───────────────────────────────────────────────

  private schedulePing(serviceId: number): void {
    if (this.pingTimer) clearTimeout(this.pingTimer);
    const intervalMs = Math.max(1, this.config.pingInterval) * 1000;
    this.pingTimer = setTimeout(() => {
      const socket = this.socket;
      if (socket && socket.readyState === 1) {
        try {
          socket.send(encodeFrame(buildPingFrame(serviceId)));
        } catch (error) {
          this.log(`feishu ws ping failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!this.stopped && this.socket) this.schedulePing(serviceId);
    }, intervalMs);
    this.pingTimer.unref?.();
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.stopped) return;
    if (this.config.reconnectCount >= 0 && this.attempts >= this.config.reconnectCount) {
      this.log(`feishu ws reconnect budget exhausted (${this.config.reconnectCount})`);
      this.setState("failed");
      return;
    }
    this.setState("reconnecting");
    // 首次重连随机抖动（防惊群）；之后固定间隔。
    const delayMs =
      this.attempts === 0
        ? this.random() * Math.max(0, this.config.reconnectNonce) * 1000
        : Math.max(0, this.config.reconnectInterval) * 1000;
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) void this.connect();
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  // ── 帧处理 ───────────────────────────────────────────────────

  private async handleFrame(data: Buffer, serviceId: number): Promise<void> {
    let frame: FeishuFrame;
    try {
      frame = decodeFrame(Buffer.isBuffer(data) ? data : Buffer.from(data));
    } catch (error) {
      this.log(`feishu ws frame decode failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (frame.method === FRAME_TYPE_CONTROL) {
      // pong：服务端可经 payload 下发新的 ClientConfig。
      if (headerValue(frame, HEADER_TYPE) === MESSAGE_TYPE_PONG && frame.payload.length > 0) {
        try {
          this.config = parseClientConfig(JSON.parse(frame.payload.toString("utf-8")));
        } catch {
          /* 保持旧配置 */
        }
      }
      return;
    }
    if (frame.method !== FRAME_TYPE_DATA) return;

    const payload = this.combine(frame);
    if (payload === null) return; // 分片未齐
    const startedAt = this.now();
    const type = headerValue(frame, HEADER_TYPE);
    try {
      let responseData: unknown;
      if (type === MESSAGE_TYPE_EVENT) {
        const envelope = parseEventEnvelope(payload.toString("utf-8"));
        await this.options.onEvent?.(envelope);
      } else if (type === MESSAGE_TYPE_CARD) {
        const envelope = parseEventEnvelope(payload.toString("utf-8"));
        responseData = await this.options.onCardAction?.(envelope);
      } else {
        // 未知 DATA 类型：礼貌 ack，不处理。
        this.log(`feishu ws: unknown data frame type '${type ?? ""}'`);
      }
      this.sendFrame(buildAckFrame(frame, this.now() - startedAt, responseData));
    } catch (error) {
      this.log(
        `feishu ws event handling failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.sendFrame(buildNackFrame(frame, this.now() - startedAt));
    }
  }

  /** 合包：sum>1 的消息按 seq 收齐后返回完整 payload；未齐返回 null。 */
  private combine(frame: FeishuFrame): Buffer | null {
    const sum = Number(headerValue(frame, HEADER_SUM) ?? "1");
    if (!Number.isFinite(sum) || sum <= 1) return frame.payload;
    const messageId = headerValue(frame, HEADER_MESSAGE_ID) ?? "";
    const seq = Number(headerValue(frame, HEADER_SEQ) ?? "0");
    let entry = this.parts.get(messageId);
    if (!entry || entry.sum !== sum) {
      entry = { sum, pieces: new Map(), firstSeenAt: this.now() };
      this.parts.set(messageId, entry);
    }
    entry.pieces.set(seq, frame.payload);
    // 60 秒前的残包清掉（防泄漏）。
    for (const [id, e] of this.parts) {
      if (this.now() - e.firstSeenAt > 60_000) this.parts.delete(id);
    }
    if (entry.pieces.size < sum) return null;
    const ordered: Buffer[] = [];
    for (let i = 0; i < sum; i += 1) {
      const piece = entry.pieces.get(i);
      if (!piece) return null; // 缺片：等下一轮（理论上不会到这里）
      ordered.push(piece);
    }
    this.parts.delete(messageId);
    return Buffer.concat(ordered);
  }

  private sendFrame(frame: FeishuFrame): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return;
    try {
      socket.send(encodeFrame(frame));
    } catch (error) {
      this.log(`feishu ws send failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
