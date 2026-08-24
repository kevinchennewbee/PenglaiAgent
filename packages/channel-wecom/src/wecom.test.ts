import assert from "node:assert/strict";
import test from "node:test";
import { WeComAdapter } from "./index.js";

test("WeCom adapter connects without QR and refuses send because it is not live", async () => {
  const adapter = new WeComAdapter(
    { resolve: () => ({ botId: "bot", secret: "sec" }) },
    () => ({
      connected: true,
      async connect() {},
      async disconnect() {},
    }),
  );
  const begun = await adapter.beginConnection({ credentialRef: "wecom-bot" });
  assert.equal(begun.qr, false);
  assert.equal(begun.live, false);
  await assert.rejects(() => adapter.sendText({ text: "hi" }), /CHANNEL_NOT_LIVE:wecom/);
});
