/**
 * 飞书协议层单测：protobuf 帧编解码（含手算字节向量）、端点发现解析、
 * 事件信封 / 消息 / 卡片回调提取、卡片构建。纯函数，不打任何网络。
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLIENT_CONFIG,
  FRAME_TYPE_CONTROL,
  FRAME_TYPE_DATA,
  buildAckFrame,
  buildApprovalCard,
  buildApprovalDecidedCard,
  buildEndpointRequestBody,
  buildNackFrame,
  buildPingFrame,
  buildTrustCard,
  decodeFrame,
  encodeFrame,
  extractCardAction,
  extractReceivedMessage,
  headerValue,
  parseClientConfig,
  parseConnectionIds,
  parseEndpointResponse,
  parseEventEnvelope,
  FeishuProtocolError,
  type FeishuFrame,
} from "../src/feishu/protocol.js";

describe("feishu protocol: protobuf frame codec", () => {
  it("encodes the ping frame to the exact hand-computed byte vector", () => {
    // Frame{service:1, method:0(CONTROL), headers:[{type:ping}]}:
    //   field3 varint 1      → 18 01
    //   field4 varint 0      → 省略（proto3 零值省略）…… 本实现省略 method=0
    //   field5 header        → 2A 0C <0A 04 "type" 12 04 "ping">（12 字节）
    const frame: FeishuFrame = {
      seqId: 0n,
      logId: 0n,
      service: 1,
      method: FRAME_TYPE_CONTROL,
      headers: [{ key: "type", value: "ping" }],
      payload: Buffer.alloc(0),
    };
    const bytes = encodeFrame(frame);
    expect(bytes.toString("hex")).toBe(
      "1801" + "2a0c" + "0a0474797065" + "120470696e67",
    );
    const decoded = decodeFrame(bytes);
    expect(decoded.service).toBe(1);
    expect(decoded.method).toBe(FRAME_TYPE_CONTROL);
    expect(decoded.headers).toEqual([{ key: "type", value: "ping" }]);
    expect(decoded.payload.length).toBe(0);
  });

  it("round-trips a full DATA frame including 64-bit ids and payload", () => {
    const frame: FeishuFrame = {
      seqId: 0xffffffffffffffffn, // uint64 max — BigInt path
      logId: 1234567890123456789n,
      service: 42,
      method: FRAME_TYPE_DATA,
      headers: [
        { key: "message_id", value: "msg_1" },
        { key: "sum", value: "1" },
        { key: "seq", value: "0" },
        { key: "type", value: "event" },
      ],
      payload: Buffer.from(JSON.stringify({ schema: "2.0" }), "utf-8"),
    };
    const decoded = decodeFrame(encodeFrame(frame));
    expect(decoded.seqId).toBe(0xffffffffffffffffn);
    expect(decoded.logId).toBe(1234567890123456789n);
    expect(decoded.service).toBe(42);
    expect(decoded.method).toBe(FRAME_TYPE_DATA);
    expect(decoded.headers).toEqual(frame.headers);
    expect(decoded.payload.toString("utf-8")).toBe('{"schema":"2.0"}');
  });

  it("decodes server-style frames that carry zero-valued varint fields explicitly", () => {
    // field1 SeqID=0 显式编码（08 00）、field2 LogID=0（10 00）、
    // field3 service=1（18 01）、field4 method=0（20 00）
    const bytes = Buffer.from("0800100018012000", "hex");
    const decoded = decodeFrame(bytes);
    expect(decoded.seqId).toBe(0n);
    expect(decoded.logId).toBe(0n);
    expect(decoded.service).toBe(1);
    expect(decoded.method).toBe(0);
  });

  it("skips unknown fields by wire type (forward compatibility)", () => {
    // field100 varint 7（未知）+ field3 service=1 + field101 32-bit（未知）
    const bytes = Buffer.from([
      ...[0xe0, 0x06, 0x07], // tag field100 wire0 = (100<<3)|0 = 800 → varint e0 06, value 07
      0x18, 0x01, // field3 = 1
      0xed, 0x06, 0x01, 0x02, 0x03, 0x04, // tag field101 wire5 = (101<<3)|5 = 813 → ed 06, 4 bytes
    ]);
    const decoded = decodeFrame(bytes);
    expect(decoded.service).toBe(1);
    expect(decoded.headers).toEqual([]);
  });

  it("rejects truncated frames with a protocol error", () => {
    expect(() => decodeFrame(Buffer.from([0x2a, 0x7f, 0x01]))).toThrow(
      FeishuProtocolError,
    );
    expect(() => decodeFrame(Buffer.from([0x08]))).toThrow(FeishuProtocolError);
  });
});

describe("feishu protocol: ping / ack frames", () => {
  it("builds the official-shaped ping frame", () => {
    const ping = buildPingFrame(7);
    expect(ping.method).toBe(FRAME_TYPE_CONTROL);
    expect(ping.service).toBe(7);
    expect(headerValue(ping, "type")).toBe("ping");
    expect(ping.payload.length).toBe(0);
  });

  it("acks reuse the incoming frame identity and append biz_rt", () => {
    const incoming: FeishuFrame = {
      seqId: 9n,
      logId: 8n,
      service: 3,
      method: FRAME_TYPE_DATA,
      headers: [{ key: "message_id", value: "m1" }],
      payload: Buffer.alloc(0),
    };
    const ack = buildAckFrame(incoming, 42);
    expect(ack.seqId).toBe(9n);
    expect(ack.method).toBe(FRAME_TYPE_DATA);
    expect(headerValue(ack, "message_id")).toBe("m1");
    expect(headerValue(ack, "biz_rt")).toBe("42");
    expect(JSON.parse(ack.payload.toString("utf-8"))).toEqual({ code: 200 });

    const withData = buildAckFrame(incoming, 1, { toast: { type: "success", content: "ok" } });
    const body = JSON.parse(withData.payload.toString("utf-8"));
    expect(body.code).toBe(200);
    expect(JSON.parse(Buffer.from(body.data, "base64").toString("utf-8"))).toEqual({
      toast: { type: "success", content: "ok" },
    });

    const nack = buildNackFrame(incoming, 3);
    expect(JSON.parse(nack.payload.toString("utf-8"))).toEqual({ code: 500 });
  });
});

describe("feishu protocol: endpoint discovery", () => {
  it("builds the Go-style request body", () => {
    expect(buildEndpointRequestBody("cli_a", "s3cr3t")).toBe(
      '{"AppID":"cli_a","AppSecret":"s3cr3t"}',
    );
  });

  it("parses the success response with client config", () => {
    const parsed = parseEndpointResponse({
      code: 0,
      msg: "ok",
      data: {
        URL: "wss://open.feishu.cn/ws/abc?device_id=d1&service_id=2",
        ClientConfig: {
          ReconnectCount: 3,
          ReconnectInterval: 60,
          ReconnectNonce: 5,
          PingInterval: 30,
        },
      },
    });
    expect(parsed.url).toContain("wss://");
    expect(parsed.clientConfig).toEqual({
      reconnectCount: 3,
      reconnectInterval: 60,
      reconnectNonce: 5,
      pingInterval: 30,
    });
    expect(parseConnectionIds(parsed.url)).toEqual({ serviceId: 2, deviceId: "d1" });
  });

  it("falls back to default client config when absent", () => {
    expect(parseClientConfig(undefined)).toEqual(DEFAULT_CLIENT_CONFIG);
    expect(parseClientConfig({ ReconnectCount: 0 }).reconnectCount).toBe(0);
    expect(parseClientConfig({ PingInterval: 45 }).pingInterval).toBe(45);
  });

  it("rejects non-zero codes and non-wss URLs", () => {
    expect(() => parseEndpointResponse({ code: 1000040344, msg: "no credential" })).toThrow(
      /1000040344/,
    );
    expect(() =>
      parseEndpointResponse({ code: 0, data: { URL: "https://nope" } }),
    ).toThrow(FeishuProtocolError);
    expect(() =>
      parseEndpointResponse({ code: 0, data: { URL: "ws://example.com/socket" } }),
    ).toThrow(FeishuProtocolError);
    expect(
      parseEndpointResponse({ code: 0, data: { URL: "ws://127.0.0.1:17777/socket" } }).url,
    ).toBe("ws://127.0.0.1:17777/socket");
  });
});

describe("feishu protocol: event envelopes", () => {
  const receivePayload = JSON.stringify({
    schema: "2.0",
    header: {
      event_id: "evt_1",
      event_type: "im.message.receive_v1",
      token: "t",
      app_id: "cli_a",
      tenant_key: "tk",
      create_time: "1700000000000",
    },
    event: {
      sender: { sender_id: { open_id: "ou_owner" }, sender_type: "user" },
      message: {
        message_id: "om_1",
        chat_id: "oc_1",
        chat_type: "p2p",
        message_type: "text",
        content: '{"text":"你好"}',
      },
    },
  });

  it("parses the schema 2.0 envelope and extracts the received message", () => {
    const envelope = parseEventEnvelope(receivePayload);
    expect(envelope.eventId).toBe("evt_1");
    expect(envelope.eventType).toBe("im.message.receive_v1");
    const msg = extractReceivedMessage(envelope.event);
    expect(msg).toEqual({
      messageId: "om_1",
      chatId: "oc_1",
      chatType: "p2p",
      senderOpenId: "ou_owner",
      senderType: "user",
      messageType: "text",
      text: "你好",
    });
  });

  it("falls back to message_id as the dedup key when event_id is absent", () => {
    const noEventId = JSON.parse(receivePayload);
    delete noEventId.header.event_id;
    const envelope = parseEventEnvelope(JSON.stringify(noEventId));
    expect(envelope.eventId).toBe("om_1");
  });

  it("refuses envelopes that carry no dedup key at all (宁漏勿重)", () => {
    const bare = JSON.parse(receivePayload);
    delete bare.header.event_id;
    delete bare.event.message.message_id;
    expect(() => parseEventEnvelope(JSON.stringify(bare))).toThrow(FeishuProtocolError);
    expect(() => parseEventEnvelope("not json")).toThrow(FeishuProtocolError);
  });

  it("extracts card actions with tolerant field paths", () => {
    const envelope = parseEventEnvelope(
      JSON.stringify({
        schema: "2.0",
        header: { event_id: "evt_c", event_type: "card.action.trigger" },
        event: {
          operator: { open_id: "ou_owner" },
          action: { value: { a: "approve", id: "appr_1" }, tag: "button" },
          context: { open_message_id: "om_9", open_chat_id: "oc_1" },
        },
      }),
    );
    expect(envelope.eventType).toBe("card.action.trigger");
    const action = extractCardAction(envelope.event);
    expect(action).toEqual({
      operatorOpenId: "ou_owner",
      value: { a: "approve", id: "appr_1" },
      openMessageId: "om_9",
      openChatId: "oc_1",
    });
    // 缺 operator 时给 null，由上层决定拒绝。
    expect(extractCardAction({}).operatorOpenId).toBeNull();
    expect(extractCardAction({}).value).toEqual({});
  });

  it("non-text message types yield empty text (channel replies politely)", () => {
    const image = extractReceivedMessage({
      sender: { sender_id: { open_id: "ou_x" }, sender_type: "user" },
      message: { message_id: "om_2", chat_id: "oc_1", chat_type: "p2p", message_type: "image", content: '{"image_key":"k"}' },
    });
    expect(image.text).toBe("");
    expect(image.messageType).toBe("image");
  });
});

describe("feishu protocol: cards", () => {
  it("builds the approval request card with button values carrying the id", () => {
    const card = buildApprovalCard({
      approvalId: "appr_1234567890",
      level: "L3",
      capability: "l3:outbound",
      action: "bash: git push",
      reason: "外发命令需要 L3 人工审批",
      taskTitle: "发版",
    });
    expect(card.header).toMatchObject({ template: "red" });
    const elements = card.elements as Array<Record<string, unknown>>;
    const action = elements.find((e) => e.tag === "action") as {
      actions: Array<{ value: { a: string; id: string } }>;
    };
    expect(action.actions[0].value).toEqual({ a: "approve", id: "appr_1234567890" });
    expect(action.actions[1].value).toEqual({ a: "reject", id: "appr_1234567890" });
    // 文本兜底指令出现在 note 里（id 前缀）。
    expect(JSON.stringify(card)).toContain("批准 appr_123");
  });

  it("builds the decided card (no buttons, provenance kept)", () => {
    const card = buildApprovalDecidedCard({
      approved: false,
      decidedBy: "feishu:ou_owner",
      note: "不准外发",
      action: "bash: curl x",
      taskTitle: "t",
    });
    expect(JSON.stringify(card)).toContain("已拒绝");
    expect(JSON.stringify(card)).toContain("feishu:ou_owner");
    expect(JSON.stringify(card)).not.toContain('"action"');
  });

  it("builds the Owner confirmation card with the exact proposal and path", () => {
    const card = buildTrustCard({
      proposalId: "proposal_1",
      conversationId: "conv_1",
      projectName: "demo",
      canonicalRootPath: "/tmp/demo",
      title: "干活",
    });
    expect(JSON.stringify(card)).toContain("confirm_work");
    expect(JSON.stringify(card)).toContain("proposal_1");
    expect(JSON.stringify(card)).toContain("conv_1");
    expect(JSON.stringify(card)).toContain("/tmp/demo");
  });
});
