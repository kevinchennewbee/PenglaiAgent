import assert from "node:assert/strict";
import test from "node:test";
import { TokenChannelAdapter } from "./token-channels.js";

test("Slack Telegram Discord connect without QR and refuse send", async () => {
  for (const id of ["slack", "telegram", "discord"] as const) {
    const adapter = new TokenChannelAdapter(id, {
      resolve: (ref) => (ref === "tok" ? "xoxb-not-a-real-token" : undefined),
    });
    await assert.rejects(() => adapter.beginConnection({ method: "qr" }), /CHANNEL_NO_QR/);
    const begun = await adapter.beginConnection({ method: "token", credentialRef: "tok" });
    assert.equal(begun.qr, false);
    assert.equal(begun.live, false);
    assert.equal((await adapter.health()).live, false);
    await assert.rejects(() => adapter.sendText({ text: "hi" }), new RegExp(`CHANNEL_NOT_LIVE:${id}`));
  }
});
