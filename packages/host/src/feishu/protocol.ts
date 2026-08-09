/**
 * 飞书开放平台协议层（纯函数，零依赖，全单测）。
 *
 * 覆盖长连接（WebSocket）事件订阅所需的最小协议面，依据官方文档与官方
 * SDK（oapi-sdk-python v2 / lark-oapi-node-sdk）的公开行为实现：
 *
 *   1. 端点发现：POST {domain}/callback/ws/endpoint，body {"AppID","AppSecret"}
 *      （Go 风格字段名），返回 wss:// URL（含 device_id / service_id 查询参数）
 *      与 ClientConfig（重连/心跳参数，Go 风格键名）。
 *   2. 帧格式：protobuf `pbbp2.Frame`，字段：
 *        uint64 SeqID = 1; uint64 LogID = 2; int32 service = 3;
 *        int32 method = 4; repeated Header headers = 5;
 *        string payload_encoding = 6; string payload_type = 7;
 *        bytes payload = 8; string LogIDOrErrCode = 9;
 *      Header = { string key = 1; string value = 2; }。
 *      本文件手工实现该固定 schema 的编解码（protobuf wire format 简单且稳定，
 *      免去 protobufjs 重型依赖）；未知字段按 wire type 跳过，向前兼容。
 *   3. 帧类型：method 0 = CONTROL（ping/pong），1 = DATA（event/card）。
 *      DATA 帧 headers 携带 message_id / trace_id / sum / seq / type；
 *      sum > 1 时需按 seq 合包（由 ws-client 完成）。
 *   4. 应答：处理完 DATA 帧后回写同帧（headers 追加 biz_rt），payload 为
 *      JSON {"code":200}；卡片回调可带 data = base64(JSON)（toast/更新卡片）。
 *   5. 事件信封（schema 2.0）：{"schema":"2.0","header":{"event_id",
 *      "event_type",...},"event":{...}}。
 *
 * 待真机联调验证：卡片回调（card.action.trigger）payload 的字段路径
 * （operator.open_id / action.value / context.open_message_id）按官方文档与
 * SDK 行为保守解析，多条路径兜底；如飞书侧调整以联调结果为准。
 */

// ── 常量 ────────────────────────────────────────────────────────

export const FEISHU_DEFAULT_DOMAIN = "https://open.feishu.cn";
export const ENDPOINT_URI = "/callback/ws/endpoint";

export const FRAME_TYPE_CONTROL = 0;
export const FRAME_TYPE_DATA = 1;

export const HEADER_TYPE = "type";
export const HEADER_MESSAGE_ID = "message_id";
export const HEADER_TRACE_ID = "trace_id";
export const HEADER_SUM = "sum";
export const HEADER_SEQ = "seq";
export const HEADER_BIZ_RT = "biz_rt";

export const MESSAGE_TYPE_EVENT = "event";
export const MESSAGE_TYPE_CARD = "card";
export const MESSAGE_TYPE_PING = "ping";
export const MESSAGE_TYPE_PONG = "pong";

export const EVENT_MESSAGE_RECEIVE = "im.message.receive_v1";
export const EVENT_CARD_ACTION = "card.action.trigger";

export class FeishuProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeishuProtocolError";
  }
}

// ── protobuf wire 编解码（固定 schema 手工实现） ──────────────────

function encodeVarint(value: bigint): number[] {
  const bytes: number[] = [];
  let v = value & 0xffffffffffffffffn; // uint64 语义
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) b |= 0x80;
    bytes.push(b);
  } while (v !== 0n);
  return bytes;
}

function decodeVarint(
  buf: Buffer,
  offset: number,
): { value: bigint; next: number } {
  let result = 0n;
  let shift = 0n;
  let pos = offset;
  for (let i = 0; i < 10; i += 1) {
    if (pos >= buf.length) throw new FeishuProtocolError("truncated varint");
    const b = buf[pos];
    pos += 1;
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: result, next: pos };
    shift += 7n;
  }
  throw new FeishuProtocolError("varint exceeds 10 bytes");
}

function encodeTag(fieldNumber: number, wireType: number): number[] {
  return encodeVarint(BigInt((fieldNumber << 3) | wireType));
}

function encodeLengthDelimited(fieldNumber: number, payload: Buffer): Buffer {
  return Buffer.from([
    ...encodeTag(fieldNumber, 2),
    ...encodeVarint(BigInt(payload.length)),
    ...payload,
  ]);
}

function encodeVarintField(fieldNumber: number, value: bigint): Buffer {
  return Buffer.from([...encodeTag(fieldNumber, 0), ...encodeVarint(value)]);
}

// ── Frame ───────────────────────────────────────────────────────

export interface FeishuFrameHeader {
  key: string;
  value: string;
}

export interface FeishuFrame {
  seqId: bigint;
  logId: bigint;
  service: number;
  method: number;
  headers: FeishuFrameHeader[];
  payload: Buffer;
}

function encodeHeader(header: FeishuFrameHeader): Buffer {
  return Buffer.concat([
    encodeLengthDelimited(1, Buffer.from(header.key, "utf-8")),
    encodeLengthDelimited(2, Buffer.from(header.value, "utf-8")),
  ]);
}

/**
 * Encode a Frame. Zero-valued scalars and empty payload are omitted (proto3
 * canonical); the server-side decoder treats missing as default.
 */
export function encodeFrame(frame: FeishuFrame): Buffer {
  const parts: Buffer[] = [];
  if (frame.seqId !== 0n) parts.push(encodeVarintField(1, frame.seqId));
  if (frame.logId !== 0n) parts.push(encodeVarintField(2, frame.logId));
  if (frame.service !== 0) parts.push(encodeVarintField(3, BigInt(frame.service)));
  if (frame.method !== 0) parts.push(encodeVarintField(4, BigInt(frame.method)));
  for (const header of frame.headers) {
    parts.push(encodeLengthDelimited(5, encodeHeader(header)));
  }
  if (frame.payload.length > 0) parts.push(encodeLengthDelimited(8, frame.payload));
  return Buffer.concat(parts);
}

/** Skip one field of unknown schema by wire type. Returns the next offset. */
function skipField(buf: Buffer, offset: number, wireType: number): number {
  switch (wireType) {
    case 0: {
      return decodeVarint(buf, offset).next;
    }
    case 1:
      if (offset + 8 > buf.length) throw new FeishuProtocolError("truncated 64-bit field");
      return offset + 8;
    case 2: {
      const { value, next } = decodeVarint(buf, offset);
      const end = next + Number(value);
      if (end > buf.length) throw new FeishuProtocolError("truncated length-delimited field");
      return end;
    }
    case 5:
      if (offset + 4 > buf.length) throw new FeishuProtocolError("truncated 32-bit field");
      return offset + 4;
    default:
      throw new FeishuProtocolError(`unsupported wire type ${wireType}`);
  }
}

function decodeHeader(buf: Buffer): FeishuFrameHeader {
  let key = "";
  let value = "";
  let offset = 0;
  while (offset < buf.length) {
    const tag = decodeVarint(buf, offset);
    offset = tag.next;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);
    if (wireType === 2 && (fieldNumber === 1 || fieldNumber === 2)) {
      const len = decodeVarint(buf, offset);
      const end = len.next + Number(len.value);
      if (end > buf.length) throw new FeishuProtocolError("truncated header field");
      const text = buf.subarray(len.next, end).toString("utf-8");
      if (fieldNumber === 1) key = text;
      else value = text;
      offset = end;
    } else {
      offset = skipField(buf, offset, wireType);
    }
  }
  return { key, value };
}

/** Decode a Frame, skipping unknown fields by wire type (forward compatible). */
export function decodeFrame(buf: Buffer): FeishuFrame {
  const frame: FeishuFrame = {
    seqId: 0n,
    logId: 0n,
    service: 0,
    method: 0,
    headers: [],
    payload: Buffer.alloc(0),
  };
  let offset = 0;
  while (offset < buf.length) {
    const tag = decodeVarint(buf, offset);
    offset = tag.next;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);
    if (wireType === 0 && (fieldNumber === 1 || fieldNumber === 2 || fieldNumber === 3 || fieldNumber === 4)) {
      const v = decodeVarint(buf, offset);
      offset = v.next;
      if (fieldNumber === 1) frame.seqId = v.value;
      else if (fieldNumber === 2) frame.logId = v.value;
      else if (fieldNumber === 3) frame.service = Number(v.value);
      else frame.method = Number(v.value);
    } else if (wireType === 2 && fieldNumber === 5) {
      const len = decodeVarint(buf, offset);
      const end = len.next + Number(len.value);
      if (end > buf.length) throw new FeishuProtocolError("truncated header entry");
      frame.headers.push(decodeHeader(buf.subarray(len.next, end)));
      offset = end;
    } else if (wireType === 2 && fieldNumber === 8) {
      const len = decodeVarint(buf, offset);
      const end = len.next + Number(len.value);
      if (end > buf.length) throw new FeishuProtocolError("truncated payload");
      frame.payload = Buffer.from(buf.subarray(len.next, end));
      offset = end;
    } else {
      offset = skipField(buf, offset, wireType);
    }
  }
  return frame;
}

/** First header value by key, or null (headers are repeated key/value). */
export function headerValue(frame: FeishuFrame, key: string): string | null {
  const found = frame.headers.find((h) => h.key === key);
  return found ? found.value : null;
}

// ── ping / ack 帧 ───────────────────────────────────────────────

/** CONTROL ping（官方 SDK：method=0、service=service_id、headers type=ping）。 */
export function buildPingFrame(serviceId: number): FeishuFrame {
  return {
    seqId: 0n,
    logId: 0n,
    service: serviceId,
    method: FRAME_TYPE_CONTROL,
    headers: [{ key: HEADER_TYPE, value: MESSAGE_TYPE_PING }],
    payload: Buffer.alloc(0),
  };
}

/**
 * 处理完成后的应答帧：沿用入帧的 seq/log/service/method/headers，追加
 * biz_rt（业务耗时 ms），payload 为 {"code":200}；卡片回调的响应体
 * （toast / 更新卡片）经 base64 放入 data。
 */
export function buildAckFrame(
  incoming: FeishuFrame,
  bizRtMs: number,
  data?: unknown,
): FeishuFrame {
  const body: { code: number; data?: string } = { code: 200 };
  if (data !== undefined) {
    body.data = Buffer.from(JSON.stringify(data), "utf-8").toString("base64");
  }
  return {
    seqId: incoming.seqId,
    logId: incoming.logId,
    service: incoming.service,
    method: incoming.method,
    headers: [
      ...incoming.headers,
      { key: HEADER_BIZ_RT, value: String(Math.max(0, Math.trunc(bizRtMs))) },
    ],
    payload: Buffer.from(JSON.stringify(body), "utf-8"),
  };
}

/** 处理失败的应答帧（code 500，官方 SDK 同形）。 */
export function buildNackFrame(incoming: FeishuFrame, bizRtMs: number): FeishuFrame {
  const frame = buildAckFrame(incoming, bizRtMs);
  frame.payload = Buffer.from(JSON.stringify({ code: 500 }), "utf-8");
  return frame;
}

// ── 端点发现 ────────────────────────────────────────────────────

export interface FeishuClientConfig {
  reconnectCount: number;
  reconnectInterval: number;
  reconnectNonce: number;
  pingInterval: number;
}

export const DEFAULT_CLIENT_CONFIG: FeishuClientConfig = {
  reconnectCount: -1, // -1 = 无限重连
  reconnectInterval: 120,
  reconnectNonce: 30,
  pingInterval: 120,
};

/** 端点发现请求体（Go 风格字段名，与官方 SDK 一致）。 */
export function buildEndpointRequestBody(appId: string, appSecret: string): string {
  return JSON.stringify({ AppID: appId, AppSecret: appSecret });
}

/** 解析 ClientConfig（Go 风格键名；缺省回落官方默认值）。 */
export function parseClientConfig(raw: unknown): FeishuClientConfig {
  const d = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    reconnectCount: num(d.ReconnectCount, DEFAULT_CLIENT_CONFIG.reconnectCount),
    reconnectInterval: num(d.ReconnectInterval, DEFAULT_CLIENT_CONFIG.reconnectInterval),
    reconnectNonce: num(d.ReconnectNonce, DEFAULT_CLIENT_CONFIG.reconnectNonce),
    pingInterval: num(d.PingInterval, DEFAULT_CLIENT_CONFIG.pingInterval),
  };
}

/**
 * 解析端点发现响应。code 0 取 data.URL 与 data.ClientConfig；
 * 非 0 抛出 FeishuProtocolError（含 code/msg，供 setup 分类报告）。
 */
export function parseEndpointResponse(raw: unknown): {
  url: string;
  clientConfig: FeishuClientConfig;
} {
  const body = (raw ?? {}) as Record<string, unknown>;
  if (body.code !== 0) {
    throw new FeishuProtocolError(
      `endpoint discovery failed: code=${String(body.code)} msg=${String(body.msg ?? "")}`,
    );
  }
  const data = (body.data ?? {}) as Record<string, unknown>;
  if (typeof data.URL !== "string") {
    throw new FeishuProtocolError("endpoint discovery returned no wss URL");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(data.URL);
  } catch {
    throw new FeishuProtocolError("endpoint discovery returned an invalid WebSocket URL");
  }
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (
    endpoint.username ||
    endpoint.password ||
    (endpoint.protocol !== "wss:" && !(endpoint.protocol === "ws:" && loopback))
  ) {
    throw new FeishuProtocolError("endpoint discovery requires wss, except ws on exact loopback");
  }
  return { url: endpoint.toString(), clientConfig: parseClientConfig(data.ClientConfig) };
}

/** 从连接 URL 提取 service_id / device_id（ping 帧与日志用）。 */
export function parseConnectionIds(url: string): {
  serviceId: number;
  deviceId: string;
} {
  const parsed = new URL(url);
  const serviceId = Number(parsed.searchParams.get("service_id") ?? "0");
  const deviceId = parsed.searchParams.get("device_id") ?? "";
  return { serviceId: Number.isFinite(serviceId) ? serviceId : 0, deviceId };
}

// ── 事件信封（schema 2.0） ──────────────────────────────────────

export interface FeishuEventEnvelope {
  schema: string;
  eventId: string;
  eventType: string;
  event: Record<string, unknown>;
}

/**
 * 解析事件信封。event_id 缺失时保守兜底为 message_id（幂等去重键不能丢），
 * 两者皆无则抛错（无法去重的事件拒绝处理，宁漏勿重）。
 */
export function parseEventEnvelope(payloadJson: string): FeishuEventEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    throw new FeishuProtocolError("event payload is not valid JSON");
  }
  const body = (parsed ?? {}) as Record<string, unknown>;
  const header = (body.header ?? {}) as Record<string, unknown>;
  const event = (body.event ?? {}) as Record<string, unknown>;
  const eventType = typeof header.event_type === "string" ? header.event_type : "";
  let eventId = typeof header.event_id === "string" ? header.event_id : "";
  if (!eventId) {
    const message = (event.message ?? {}) as Record<string, unknown>;
    if (typeof message.message_id === "string") eventId = message.message_id;
  }
  if (!eventType || !eventId) {
    throw new FeishuProtocolError(
      `event envelope missing event_type/event_id (type=${eventType || "?"})`,
    );
  }
  return {
    schema: typeof body.schema === "string" ? body.schema : "2.0",
    eventId,
    eventType,
    event,
  };
}

// ── im.message.receive_v1 ───────────────────────────────────────

export interface FeishuReceivedMessage {
  messageId: string;
  chatId: string;
  chatType: string;
  senderOpenId: string | null;
  senderType: string;
  messageType: string;
  /** message_type=text 时提取的纯文本；其他类型为空串。 */
  text: string;
}

/** 从事件体提取收到的消息（宽容解析，字段缺失给安全默认）。 */
export function extractReceivedMessage(
  event: Record<string, unknown>,
): FeishuReceivedMessage {
  const sender = (event.sender ?? {}) as Record<string, unknown>;
  const senderId = (sender.sender_id ?? {}) as Record<string, unknown>;
  const message = (event.message ?? {}) as Record<string, unknown>;
  const messageType = typeof message.message_type === "string" ? message.message_type : "";
  let text = "";
  if (messageType === "text" && typeof message.content === "string") {
    try {
      const content = JSON.parse(message.content) as Record<string, unknown>;
      if (typeof content.text === "string") text = content.text;
    } catch {
      /* 非 JSON content：按空文本处理 */
    }
  }
  return {
    messageId: typeof message.message_id === "string" ? message.message_id : "",
    chatId: typeof message.chat_id === "string" ? message.chat_id : "",
    chatType: typeof message.chat_type === "string" ? message.chat_type : "",
    senderOpenId: typeof senderId.open_id === "string" ? senderId.open_id : null,
    senderType: typeof sender.sender_type === "string" ? sender.sender_type : "",
    messageType,
    text,
  };
}

// ── card.action.trigger ─────────────────────────────────────────

export interface FeishuCardAction {
  operatorOpenId: string | null;
  /** 按钮 value（构建卡片时写入，回调原样带回）。 */
  value: Record<string, unknown>;
  openMessageId: string | null;
  openChatId: string | null;
}

/**
 * 提取卡片回调。待真机联调验证：operator.open_id / context.open_message_id
 * 的字段路径按官方文档保守解析并多路径兜底。
 */
export function extractCardAction(event: Record<string, unknown>): FeishuCardAction {
  const operator = (event.operator ?? {}) as Record<string, unknown>;
  const action = (event.action ?? {}) as Record<string, unknown>;
  const context = (event.context ?? {}) as Record<string, unknown>;
  const value =
    action.value && typeof action.value === "object" && !Array.isArray(action.value)
      ? (action.value as Record<string, unknown>)
      : {};
  return {
    operatorOpenId:
      (typeof operator.open_id === "string" && operator.open_id) ||
      (typeof operator.user_id === "string" && operator.user_id) ||
      null,
    value,
    openMessageId:
      (typeof context.open_message_id === "string" && context.open_message_id) || null,
    openChatId: (typeof context.open_chat_id === "string" && context.open_chat_id) || null,
  };
}

// ── 卡片构建（legacy interactive card JSON，兼容性最稳） ──────────

export type FeishuCard = Record<string, unknown>;

function mdText(content: string): Record<string, unknown> {
  return { tag: "lark_md", content };
}

function divField(content: string, isShort = true): Record<string, unknown> {
  return { is_short: isShort, text: mdText(content) };
}

/** 审批请求卡片：级别/操作/理由/任务 + 批准/拒绝按钮（value 携带审批 id）。 */
export function buildApprovalCard(input: {
  approvalId: string;
  level: "L2" | "L3";
  capability: string;
  action: string;
  reason: string;
  taskTitle: string;
}): FeishuCard {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `⚠️ ${input.level} 审批请求` },
      template: input.level === "L3" ? "red" : "orange",
    },
    elements: [
      {
        tag: "div",
        fields: [
          divField(`**级别**\n${input.level}（${input.capability}）`),
          divField(`**任务**\n${input.taskTitle}`),
        ],
      },
      { tag: "div", text: mdText(`**操作**\n${input.action}`) },
      { tag: "div", text: mdText(`**理由**\n${input.reason}`) },
      { tag: "hr" },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "批准" },
            type: "primary",
            value: { a: "approve", id: input.approvalId },
          },
          {
            tag: "button",
            text: { tag: "plain_text", content: "拒绝" },
            type: "danger",
            value: { a: "reject", id: input.approvalId },
          },
        ],
      },
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: `也可回复：批准 ${input.approvalId.slice(0, 8)} 或 拒绝 ${input.approvalId.slice(0, 8)}`,
          },
        ],
      },
    ],
  };
}

/** 审批已决定的更新卡片（替换请求卡片，按钮移除，留决定溯源）。 */
export function buildApprovalDecidedCard(input: {
  approved: boolean;
  decidedBy: string;
  note?: string | null;
  action: string;
  taskTitle: string;
}): FeishuCard {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: "plain_text",
        content: input.approved ? "✅ 已批准" : "⛔ 已拒绝",
      },
      template: input.approved ? "green" : "grey",
    },
    elements: [
      { tag: "div", text: mdText(`**操作**\n${input.action}`) },
      { tag: "div", text: mdText(`**任务**\n${input.taskTitle}`) },
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: `决定人 ${input.decidedBy}${input.note ? ` · ${input.note}` : ""}`,
          },
        ],
      },
    ],
  };
}

/** Owner 开工确认卡片：proposal 本身没有信任、Task 或执行权限。 */
export function buildTrustCard(input: {
  proposalId: string;
  conversationId: string;
  projectName: string;
  canonicalRootPath: string;
  title: string;
}): FeishuCard {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "🔒 Owner 开工确认" },
      template: "orange",
    },
    elements: [
      {
        tag: "div",
        text: mdText(
          `拟在项目 **${input.projectName}** 开始「${input.title}」\n` +
            `精确路径：\`${input.canonicalRootPath}\`\n\n` +
            `确认前不会信任项目、创建任务或激活工作区；确认后 L1–L4 审批四级制仍生效。`,
        ),
      },
      { tag: "hr" },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "确认工作区并开工" },
            type: "primary",
            value: {
              a: "confirm_work",
              proposal: input.proposalId,
              conversation: input.conversationId,
              path: input.canonicalRootPath,
            },
          },
        ],
      },
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: `也可以在 CLI 确认：penglai work confirm ${input.proposalId} ${JSON.stringify(input.canonicalRootPath)}`,
          },
        ],
      },
    ],
  };
}
