import assert from "node:assert/strict";
import test from "node:test";
import { WeComAdapter } from "./index.js";
import { WeComQrAuth } from "./qr-auth.js";

test("WeCom token path connects and can send through an injected client", async () => {
  let sent = "";
  const adapter = new WeComAdapter(
    { resolve: () => ({ botId: "bot", secret: "sec" }) },
    () => ({
      connected: true,
      async connect() {},
      async disconnect() {},
      async send(_peer, text) {
        sent = text;
      },
    }),
  );
  const begun = await adapter.beginConnection({ method: "token", credentialRef: "PENGLAI_WECOM_BOT" });
  assert.equal(begun.kind, "token");
  assert.equal(begun.connection, "connected");
  await assert.rejects(() => adapter.sendText({ text: "hi" }), /WECOM_REPLY_TARGET/);
  await adapter.sendText({ text: "hi", peerRef: "user-1" });
  assert.equal(sent, "hi");
});

test("WeCom QR poll stores bot credentials without returning secrets", async () => {
  const stored: Record<string, { botId: string; secret: string }> = {};
  const auth = new WeComQrAuth(async (url) => {
    const href = String(url);
    if (href.includes("/generate")) {
      return new Response(
        JSON.stringify({ data: { scode: "sc1", auth_url: "https://work.weixin.qq.com/ai/qc?x=1" } }),
      );
    }
    return new Response(
      JSON.stringify({ data: { status: "success", bot_info: { botid: "b1", secret: "s1" } } }),
    );
  });
  const adapter = new WeComAdapter(
    {
      resolve: (ref) => stored[ref],
      put: (ref, creds) => {
        stored[ref] = creds;
      },
    },
    () => ({
      connected: true,
      async connect() {},
      async disconnect() {},
    }),
    auth,
  );
  const begun = await adapter.beginConnection({ method: "qr" });
  assert.equal(begun.kind, "qr");
  assert.equal("secret" in begun, false);
  await adapter.pollConnection(begun.operationId);
  assert.equal(stored.PENGLAI_WECOM_BOT?.botId, "b1");
});
