import assert from "node:assert/strict";
import test from "node:test";
import { QqAdapter } from "./index.js";

test("QQ adapter connects without QR and refuses send because it is not live", async () => {
  const adapter = new QqAdapter(
    { resolve: () => ({ appId: "app", clientSecret: "sec" }) },
    () => ({
      connected: true,
      async connect() {},
      async disconnect() {},
    }),
  );
  const begun = await adapter.beginConnection({ credentialRef: "qq-bot" });
  assert.equal(begun.qr, false);
  assert.equal(begun.live, false);
  await assert.rejects(() => adapter.sendText({ text: "hi" }), /CHANNEL_NOT_LIVE:qq/);
});
