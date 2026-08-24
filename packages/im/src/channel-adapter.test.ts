import assert from "node:assert/strict";
import test from "node:test";
import { CHANNEL_IDS, LIVE_CHANNEL_IDS, refuseFakeQr } from "./registry.js";
import { assertLiveSend, guidedAdapter } from "./channel-adapter.js";

test("non-live channels refuse send and never mint a fake QR", async () => {
  for (const id of CHANNEL_IDS) {
    if ((LIVE_CHANNEL_IDS as readonly string[]).includes(id)) continue;
    const adapter = guidedAdapter(id);
    assert.equal(adapter.id, id);
    const begun = await adapter.beginConnection({ method: "token" });
    assert.equal(begun.qr, false);
    assert.equal(begun.live, false);
    const health = await adapter.health();
    assert.equal(health.live, false);
    await assert.rejects(() => adapter.sendText({ text: "hi" }), /CHANNEL_NOT_LIVE/);
    await assert.rejects(() => adapter.sendArtifact({ artifactId: "sha256:" + "a".repeat(64) }), /CHANNEL_NOT_LIVE/);
    assert.throws(() => assertLiveSend(id), /CHANNEL_NOT_LIVE/);
  }
  assert.throws(() => refuseFakeQr("slack", "qr"), /CHANNEL_NO_QR/);
  assert.throws(() => refuseFakeQr("telegram", "qr"), /CHANNEL_NO_QR/);
  assert.throws(() => refuseFakeQr("discord", "qr"), /CHANNEL_NO_QR/);
});
