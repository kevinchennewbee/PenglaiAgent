/**
 * Mock 飞书服务端（测试专用）— 真实 loopback HTTP + WebSocket 服务器，
 * 实现长连接协议面与最小 REST 面：
 *
 *   POST /callback/ws/endpoint                              → wss URL + ClientConfig
 *   POST /open-apis/auth/v3/tenant_access_token/internal    → 固定 token
 *   POST /open-apis/im/v1/messages?receive_id_type=chat_id  → 记录 + message_id
 *   PATCH /open-apis/im/v1/messages/:id                     → 记录
 *   WS   /ws                                                → 收帧（ping/ack 断言）
 *                                                              注入 event/card 帧
 *
 * 所有断言都落在这个 mock 的可观测面上：API 调用记录、收到的帧、连接次数。
 * 测试绝不打真实飞书 API。
 */

import * as http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  FRAME_TYPE_DATA,
  HEADER_MESSAGE_ID,
  HEADER_SEQ,
  HEADER_SUM,
  HEADER_TRACE_ID,
  HEADER_TYPE,
  MESSAGE_TYPE_CARD,
  MESSAGE_TYPE_EVENT,
  decodeFrame,
  encodeFrame,
  type FeishuClientConfig,
  type FeishuFrame,
} from "../../src/feishu/protocol.js";

export interface RecordedApiCall {
  method: string;
  path: string;
  body: Record<string, unknown>;
  authorization: string | null;
}

export class MockFeishuServer {
  private httpServer: http.Server | null = null;
  private wsServer: WebSocketServer | null = null;
  private readonly sockets = new Set<WebSocket>();
  readonly apiCalls: RecordedApiCall[] = [];
  readonly frames: FeishuFrame[] = [];
  /** 成功建立的 WS 连接总数（重连断言用）。 */
  connections = 0;
  /** 可调的端点响应（默认快速心跳/立即重连，测试不等真实秒级）。 */
  clientConfig: FeishuClientConfig = {
    reconnectCount: -1,
    reconnectInterval: 0,
    reconnectNonce: 0,
    pingInterval: 120,
  };
  /** 端点发现固定失败（ fatal 测试）：设为非 0 code。 */
  endpointFailure: { code: number; msg: string } | null = null;
  /** 每个连接注入事件用的序号。 */
  private frameSeq = 0n;
  port = 0;

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    this.httpServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const bodyText = Buffer.concat(chunks).toString("utf-8");
        let body: Record<string, unknown> = {};
        try {
          body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
        } catch {
          /* 非 JSON body 按空对象记录 */
        }
        const url = req.url ?? "/";
        const auth =
          typeof req.headers.authorization === "string"
            ? req.headers.authorization
            : null;

        if (req.method === "POST" && url === "/callback/ws/endpoint") {
          this.apiCalls.push({ method: "POST", path: url, body, authorization: auth });
          if (this.endpointFailure) {
            this.reply(res, { code: this.endpointFailure.code, msg: this.endpointFailure.msg });
            return;
          }
          this.reply(res, {
            code: 0,
            msg: "ok",
            data: {
              URL: `ws://127.0.0.1:${this.port}/ws?device_id=mock-device&service_id=7`,
              ClientConfig: {
                ReconnectCount: this.clientConfig.reconnectCount,
                ReconnectInterval: this.clientConfig.reconnectInterval,
                ReconnectNonce: this.clientConfig.reconnectNonce,
                PingInterval: this.clientConfig.pingInterval,
              },
            },
          });
          return;
        }
        if (req.method === "POST" && url === "/open-apis/auth/v3/tenant_access_token/internal") {
          this.apiCalls.push({ method: "POST", path: url, body, authorization: auth });
          this.reply(res, { code: 0, msg: "ok", tenant_access_token: "t-mock-token", expire: 7200 });
          return;
        }
        if (req.method === "POST" && url.startsWith("/open-apis/im/v1/messages")) {
          this.apiCalls.push({ method: "POST", path: url, body, authorization: auth });
          this.reply(res, {
            code: 0,
            msg: "ok",
            data: { message_id: `om_mock_${this.apiCalls.length}` },
          });
          return;
        }
        if (req.method === "PATCH" && url.startsWith("/open-apis/im/v1/messages/")) {
          this.apiCalls.push({ method: "PATCH", path: url, body, authorization: auth });
          this.reply(res, { code: 0, msg: "ok", data: {} });
          return;
        }
        this.reply(res, { code: 40404, msg: `mock: unknown route ${req.method} ${url}` }, 404);
      });
    });
    this.wsServer = new WebSocketServer({ server: this.httpServer, path: "/ws" });
    this.wsServer.on("connection", (socket) => {
      this.connections += 1;
      this.sockets.add(socket);
      socket.on("message", (data: Buffer) => {
        try {
          this.frames.push(decodeFrame(Buffer.isBuffer(data) ? data : Buffer.from(data)));
        } catch {
          /* 客户端发了非协议帧：记录忽略 */
        }
      });
      socket.on("close", () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve) => {
      this.httpServer!.listen(0, "127.0.0.1", () => {
        const addr = this.httpServer!.address();
        this.port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  }

  private reply(res: http.ServerResponse, payload: unknown, status = 200): void {
    const text = JSON.stringify(payload);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(text);
  }

  /** 向所有连接注入一个 DATA 帧（event / card），payload 为完整信封对象。 */
  pushDataFrame(
    type: typeof MESSAGE_TYPE_EVENT | typeof MESSAGE_TYPE_CARD,
    envelope: Record<string, unknown>,
    options: { sum?: number; seq?: number; messageId?: string } = {},
  ): void {
    this.pushDataFrameRaw(Buffer.from(JSON.stringify(envelope), "utf-8"), {
      ...options,
      type,
    });
  }

  /** 注入原始 payload 的 DATA 帧（合包测试：任意字节分片）。 */
  pushDataFrameRaw(
    payload: Buffer,
    options: {
      sum?: number;
      seq?: number;
      messageId?: string;
      type?: string;
    } = {},
  ): void {
    const frame: FeishuFrame = {
      seqId: (this.frameSeq += 1n),
      logId: 0n,
      service: 7,
      method: FRAME_TYPE_DATA,
      headers: [
        { key: HEADER_MESSAGE_ID, value: options.messageId ?? `mm_${this.frameSeq}` },
        { key: HEADER_TRACE_ID, value: "trace_mock" },
        { key: HEADER_SUM, value: String(options.sum ?? 1) },
        { key: HEADER_SEQ, value: String(options.seq ?? 0) },
        { key: HEADER_TYPE, value: options.type ?? MESSAGE_TYPE_EVENT },
      ],
      payload,
    };
    const bytes = encodeFrame(frame);
    for (const socket of this.sockets) socket.send(bytes);
  }

  pushEvent(envelope: Record<string, unknown>, options?: { sum?: number; seq?: number; messageId?: string }): void {
    this.pushDataFrame(MESSAGE_TYPE_EVENT, envelope, options);
  }

  pushCard(envelope: Record<string, unknown>): void {
    this.pushDataFrame(MESSAGE_TYPE_CARD, envelope);
  }

  /** 粗暴断开所有连接（重连测试）。 */
  dropConnections(): void {
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
  }

  /** 等一帧满足谓词（默认 3s 超时）。 */
  async waitForFrame(
    predicate: (frame: FeishuFrame) => boolean,
    timeoutMs = 3000,
  ): Promise<FeishuFrame> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.frames.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("mock feishu: no matching frame in time");
  }

  /** 等一个 API 调用满足谓词（默认 3s 超时）。 */
  async waitForApiCall(
    predicate: (call: RecordedApiCall) => boolean,
    timeoutMs = 3000,
  ): Promise<RecordedApiCall> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.apiCalls.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("mock feishu: no matching api call in time");
  }

  /** 已发送的 im 消息（文本/卡片）body 列表。 */
  sentMessages(): RecordedApiCall[] {
    return this.apiCalls.filter(
      (call) => call.method === "POST" && call.path.startsWith("/open-apis/im/v1/messages"),
    );
  }

  /** 已更新的卡片消息（PATCH）body 列表。 */
  updatedCards(): RecordedApiCall[] {
    return this.apiCalls.filter((call) => call.method === "PATCH");
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.wsServer?.close(() => resolve()));
    this.httpServer?.closeIdleConnections?.();
    await new Promise<void>((resolve) => this.httpServer?.close(() => resolve()));
  }
}

/** 构造 im.message.receive_v1 信封（测试注入消息用）。 */
export function receiveMessageEnvelope(input: {
  eventId: string;
  openId: string;
  chatId?: string;
  text?: string;
  messageType?: string;
  content?: string;
  chatType?: string;
  senderType?: string;
  messageId?: string;
}): Record<string, unknown> {
  const messageType = input.messageType ?? "text";
  return {
    schema: "2.0",
    header: { event_id: input.eventId, event_type: "im.message.receive_v1" },
    event: {
      sender: {
        sender_id: { open_id: input.openId },
        sender_type: input.senderType ?? "user",
      },
      message: {
        message_id: input.messageId ?? `om_${input.eventId}`,
        chat_id: input.chatId ?? "oc_chat1",
        chat_type: input.chatType ?? "p2p",
        message_type: messageType,
        content:
          input.content ??
          (messageType === "text" ? JSON.stringify({ text: input.text ?? "" }) : "{}"),
      },
    },
  };
}

/** 构造 card.action.trigger 信封（测试注入按钮点击用）。 */
export function cardActionEnvelope(input: {
  eventId: string;
  openId: string;
  value: Record<string, unknown>;
  chatId?: string;
  messageId?: string;
}): Record<string, unknown> {
  return {
    schema: "2.0",
    header: { event_id: input.eventId, event_type: "card.action.trigger" },
    event: {
      operator: { open_id: input.openId },
      action: { value: input.value, tag: "button" },
      context: {
        open_message_id: input.messageId ?? "om_card1",
        open_chat_id: input.chatId ?? "oc_chat1",
      },
    },
  };
}
