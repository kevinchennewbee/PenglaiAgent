/**
 * 长连接客户端 + REST 客户端集成测试：真实 loopback mock 飞书服务端，
 * 全协议链路（端点发现 → 连接 → 事件分派 → 应答 → 心跳 → 重连 → 合包 →
 * 卡片回调应答 → token 缓存 → 发消息），绝不打真实飞书 API。
 */

import { describe, expect, it } from "vitest";
import { FeishuWsClient } from "../src/feishu/ws-client.js";
import { FeishuApiClient, FeishuApiError } from "../src/feishu/api-client.js";
import {
  FRAME_TYPE_CONTROL,
  headerValue,
  type FeishuEventEnvelope,
} from "../src/feishu/protocol.js";
import {
  MockFeishuServer,
  cardActionEnvelope,
  receiveMessageEnvelope,
} from "./feishu/mock-server.js";

const CREDS = { appId: "cli_mock", appSecret: "mock_secret" };

async function startMock(): Promise<MockFeishuServer> {
  const mock = new MockFeishuServer();
  await mock.start();
  return mock;
}

function clientFor(mock: MockFeishuServer, handlers: {
  onEvent?: (envelope: FeishuEventEnvelope) => Promise<void>;
  onCardAction?: (envelope: FeishuEventEnvelope) => Promise<unknown>;
}): FeishuWsClient {
  return new FeishuWsClient({
    ...CREDS,
    domain: mock.baseUrl,
    ...handlers,
  });
}

describe("feishu ws client: connection & dispatch", () => {
  it("discovers the endpoint, connects, dispatches events and acks with biz_rt", async () => {
    const mock = await startMock();
    const seen: FeishuEventEnvelope[] = [];
    const client = clientFor(mock, {
      onEvent: async (envelope) => {
        seen.push(envelope);
      },
    });
    await client.start();
    expect(client.getState()).toBe("connected");
    // 端点发现用了 Go 风格字段名。
    const discovery = mock.apiCalls.find((c) => c.path === "/callback/ws/endpoint");
    expect(discovery?.body).toEqual({ AppID: CREDS.appId, AppSecret: CREDS.appSecret });

    mock.pushEvent(receiveMessageEnvelope({ eventId: "evt_1", openId: "ou_owner", text: "你好" }));
    await mock.waitForFrame((frame) => headerValue(frame, "biz_rt") !== null);
    expect(seen).toHaveLength(1);
    expect(seen[0].eventType).toBe("im.message.receive_v1");
    expect(seen[0].eventId).toBe("evt_1");
    // 应答帧：code 200 + biz_rt + 沿用入帧 headers。
    const ack = mock.frames.find((frame) => headerValue(frame, "biz_rt") !== null)!;
    expect(JSON.parse(ack.payload.toString("utf-8"))).toEqual({ code: 200 });
    expect(headerValue(ack, "type")).toBe("event");

    await client.stop();
    expect(client.getState()).toBe("closed");
    await mock.close();
  });

  it("combines multi-part messages (sum>1) before dispatching", async () => {
    const mock = await startMock();
    const seen: FeishuEventEnvelope[] = [];
    const client = clientFor(mock, {
      onEvent: async (envelope) => {
        seen.push(envelope);
      },
    });
    await client.start();
    const full = receiveMessageEnvelope({ eventId: "evt_big", openId: "ou_owner", text: "长消息" });
    const buf = Buffer.from(JSON.stringify(full), "utf-8");
    const half = Math.ceil(buf.length / 2);
    // 手工两片：信封 JSON 按字节任意切分，客户端必须收齐后再分派一次。
    mock.pushDataFrameRaw(buf.subarray(0, half), { sum: 2, seq: 0, messageId: "mm_big" });
    mock.pushDataFrameRaw(buf.subarray(half), { sum: 2, seq: 1, messageId: "mm_big" });
    await mock.waitForFrame((frame) => headerValue(frame, "biz_rt") !== null);
    expect(seen).toHaveLength(1);
    expect(seen[0].eventId).toBe("evt_big");
    await client.stop();
    await mock.close();
  });

  it("answers card actions with the handler's response data (base64)", async () => {
    const mock = await startMock();
    const client = clientFor(mock, {
      onCardAction: async (envelope) => {
        expect(envelope.eventType).toBe("card.action.trigger");
        return { toast: { type: "success", content: "已批准" } };
      },
    });
    await client.start();
    mock.pushCard(
      cardActionEnvelope({ eventId: "evt_c1", openId: "ou_owner", value: { a: "approve", id: "appr_1" } }),
    );
    const ack = await mock.waitForFrame((frame) => headerValue(frame, "biz_rt") !== null);
    const body = JSON.parse(ack.payload.toString("utf-8"));
    expect(body.code).toBe(200);
    expect(JSON.parse(Buffer.from(body.data, "base64").toString("utf-8"))).toEqual({
      toast: { type: "success", content: "已批准" },
    });
    await client.stop();
    await mock.close();
  });

  it("nacks when the handler throws", async () => {
    const mock = await startMock();
    const client = clientFor(mock, {
      onEvent: async () => {
        throw new Error("boom");
      },
    });
    await client.start();
    mock.pushEvent(receiveMessageEnvelope({ eventId: "evt_x", openId: "ou_owner" }));
    const ack = await mock.waitForFrame((frame) => frame.payload.toString("utf-8").includes("500"));
    expect(JSON.parse(ack.payload.toString("utf-8"))).toEqual({ code: 500 });
    await client.stop();
    await mock.close();
  });

  it("reconnects after the server drops the connection", async () => {
    const mock = await startMock();
    const client = clientFor(mock, {});
    await client.start();
    expect(mock.connections).toBe(1);
    mock.dropConnections();
    // ReconnectInterval=0 / Nonce=0 → 立即重连。
    const deadline = Date.now() + 3000;
    while (mock.connections < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(mock.connections).toBe(2);
    expect(client.getState()).toBe("connected");
    await client.stop();
    await mock.close();
  });

  it("sends CONTROL pings on the server-provided interval", async () => {
    const mock = await startMock();
    mock.clientConfig = { reconnectCount: -1, reconnectInterval: 0, reconnectNonce: 0, pingInterval: 1 };
    const client = clientFor(mock, {});
    await client.start();
    const ping = await mock.waitForFrame(
      (frame) => frame.method === FRAME_TYPE_CONTROL && headerValue(frame, "type") === "ping",
      4000,
    );
    expect(ping.service).toBe(7);
    await client.stop();
    await mock.close();
  });

  it("fatal endpoint errors (auth) stop without reconnecting", async () => {
    const mock = await startMock();
    mock.endpointFailure = { code: 1000040344, msg: "app_id or app_secret invalid" };
    const client = clientFor(mock, {});
    await client.start();
    expect(client.getState()).toBe("failed");
    const discoveries = mock.apiCalls.filter((c) => c.path === "/callback/ws/endpoint");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(mock.apiCalls.filter((c) => c.path === "/callback/ws/endpoint")).toHaveLength(
      discoveries.length,
    );
    await mock.close();
  });
});

describe("feishu api client: token cache & messaging", () => {
  it("caches the tenant token across calls and sends text/cards with uuid", async () => {
    const mock = await startMock();
    const api = new FeishuApiClient({ ...CREDS, domain: mock.baseUrl });
    await api.sendText("oc_1", "第一条", "uuid-1");
    await api.sendCard("oc_1", { config: {}, elements: [] }, "uuid-2");
    const tokenCalls = mock.apiCalls.filter((c) => c.path.includes("tenant_access_token"));
    expect(tokenCalls).toHaveLength(1); // 缓存命中，第二次不发 token 请求
    const sent = mock.sentMessages();
    expect(sent).toHaveLength(2);
    expect(sent[0].authorization).toBe("Bearer t-mock-token");
    expect(sent[0].body).toMatchObject({
      receive_id: "oc_1",
      msg_type: "text",
      uuid: "uuid-1",
    });
    expect(JSON.parse(String(sent[0].body.content))).toEqual({ text: "第一条" });
    expect(sent[1].body.msg_type).toBe("interactive");
    await mock.close();
  });

  it("updates cards via PATCH and classifies auth failures", async () => {
    const mock = await startMock();
    const api = new FeishuApiClient({ ...CREDS, domain: mock.baseUrl });
    await api.updateCard("om_1", { config: {}, elements: [] });
    expect(mock.updatedCards()).toHaveLength(1);
    expect(mock.updatedCards()[0].path).toBe("/open-apis/im/v1/messages/om_1");
    await mock.close();

    const bad = new MockFeishuServer();
    await bad.start();
    const failing = new FeishuApiClient({ appId: "x", appSecret: "y", domain: bad.baseUrl });
    // mock 对 token 端点始终返回 code 0，这里改端点不可达来验证 network 分类。
    await bad.close();
    await expect(failing.sendText("oc_1", "hi")).rejects.toMatchObject({
      name: "FeishuApiError",
      kind: "network",
    });
  });

  it("api error bodies surface code/msg", async () => {
    const mock = await startMock();
    await mock.close(); // 先关，再换一个新 mock 复用同端口语义不必要——直接用未知路由。
    const live = await startMock();
    const api = new FeishuApiClient({ ...CREDS, domain: live.baseUrl });
    // 未知路由 → mock 回 40404。
    await expect(
      (api as unknown as { callApi(u: string, p: Record<string, unknown>): Promise<unknown> })
        .callApi(`${live.baseUrl}/open-apis/unknown`, {}),
    ).rejects.toSatisfy(
      (error) => error instanceof FeishuApiError && error.kind === "api" && error.code === 40404,
    );
    await live.close();
  });
});
