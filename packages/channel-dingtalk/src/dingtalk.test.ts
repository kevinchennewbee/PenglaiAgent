import assert from "node:assert/strict";
import test from "node:test";
import { DingTalkAdapter } from "./index.js";
import { DingTalkDeviceAuth, DINGTALK_REGISTRATION_SOURCE } from "./device-auth.js";

test("DingTalk QR does not return secrets and stores credentials on success", async () => {
  const stored: Record<string, { clientId: string; clientSecret: string }> = {};
  const posts: string[] = [];
  const auth = new DingTalkDeviceAuth(async (url, init) => {
    posts.push(String(url));
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    if (String(url).endsWith("/init")) {
      assert.equal(body.source, DINGTALK_REGISTRATION_SOURCE);
      return new Response(JSON.stringify({ errcode: 0, nonce: "n1" }));
    }
    if (String(url).endsWith("/begin")) {
      assert.equal(body.nonce, "n1");
      return new Response(
        JSON.stringify({
          errcode: 0,
          device_code: "dev-1",
          verification_uri_complete: "https://login.dingtalk.com/oauth2/auth",
          expires_in: 120,
          interval: 1,
        }),
      );
    }
    return new Response(
      JSON.stringify({ errcode: 0, status: "SUCCESS", client_id: "cli", client_secret: "sec" }),
    );
  });
  let sent = "";
  const adapter = new DingTalkAdapter(
    {
      resolve: (ref) => stored[ref],
      put: (ref, creds) => {
        stored[ref] = creds;
      },
    },
    () => ({
      connected: true,
      async connect() {
        /* connected */
      },
      async disconnect() {
        /* closed */
      },
      async send(_peer, text) {
        sent = text;
      },
    }),
    auth,
  );
  const begun = await adapter.beginConnection({ method: "qr" });
  assert.equal(begun.kind, "qr");
  assert.equal(begun.connection, "connecting");
  assert.equal("clientSecret" in begun, false);
  const peeked = adapter.peekQr(begun.operationId);
  assert.match(peeked?.verificationUrl ?? "", /^https:\/\/login\.dingtalk\.com\//);
  const polled = await adapter.pollConnection(begun.operationId);
  assert.equal(polled.status, "connected");
  assert.equal(stored.PENGLAI_DINGTALK_CLIENT?.clientId, "cli");
  await assert.rejects(() => adapter.sendText({ text: "hello" }), /DINGTALK_REPLY_TARGET/);
  const delivered = await adapter.sendText({ text: "hello", peerRef: "staff-1" });
  assert.equal(delivered.delivered, true);
  assert.equal(sent, "hello");
  await adapter.disconnect();
});

test("DingTalk adapter fails closed without credentials", async () => {
  const adapter = new DingTalkAdapter({ resolve: () => undefined });
  await assert.rejects(() => adapter.beginConnection({ method: "token", credentialRef: "missing" }), /credentials missing/);
  assert.equal(adapter.health().connection, "not_configured");
});

test("DingTalk persists private-session reply targets in the credential vault", async () => {
  const stored: Record<string, { clientId: string; clientSecret: string; sessionWebhooks?: Record<string, string> }> = {
    PENGLAI_DINGTALK_CLIENT: { clientId: "cli", clientSecret: "sec" },
  };
  let capture: ((vendorTarget: string, sessionWebhook: string) => void | Promise<void>) | undefined;
  const adapter = new DingTalkAdapter(
    {
      resolve: (ref) => stored[ref],
      put: (ref, creds) => {
        stored[ref] = creds;
      },
    },
    () => ({
      connected: true,
      connect() {},
      disconnect() {},
      onReplyTarget(handler) {
        capture = handler;
      },
    }),
  );
  await adapter.beginConnection({ method: "token", credentialRef: "PENGLAI_DINGTALK_CLIENT" });
  await capture?.("conversation-1", "https://oapi.dingtalk.com/robot/sendBySession?session=opaque");
  assert.equal(
    stored.PENGLAI_DINGTALK_CLIENT?.sessionWebhooks?.["conversation-1"],
    "https://oapi.dingtalk.com/robot/sendBySession?session=opaque",
  );
});
