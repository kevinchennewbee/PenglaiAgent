import assert from "node:assert/strict";
import test from "node:test";
import { DingTalkAdapter } from "./index.js";

test("DingTalk adapter connects without QR and refuses send because it is not live", async () => {
  let connected = false;
  const adapter = new DingTalkAdapter(
    { resolve: () => ({ clientId: "cli", clientSecret: "sec" }) },
    () => ({
      connected: true,
      async connect() {
        connected = true;
      },
      async disconnect() {
        connected = false;
      },
    }),
  );
  const begun = await adapter.beginConnection({ credentialRef: "dingtalk-bot" });
  assert.equal(begun.qr, false);
  assert.equal(begun.live, false);
  assert.equal(begun.connection, "connected");
  assert.equal(connected, true);
  assert.equal(adapter.health().live, false);
  await assert.rejects(() => adapter.sendText({ text: "hi" }), /CHANNEL_NOT_LIVE:dingtalk/);
  await adapter.disconnect();
  assert.equal(adapter.health().connection, "disabled");
});

test("DingTalk adapter fails closed without credentials", async () => {
  const adapter = new DingTalkAdapter({ resolve: () => undefined });
  await assert.rejects(() => adapter.beginConnection({ credentialRef: "missing" }), /credentials missing/);
  assert.equal(adapter.health().connection, "not_configured");
});
