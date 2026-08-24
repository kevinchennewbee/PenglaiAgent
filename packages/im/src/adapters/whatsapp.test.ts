import assert from "node:assert/strict";
import test from "node:test";
import { WhatsAppAdapter } from "./whatsapp.js";

test("WhatsApp stays experimental, needs risk ack, and is not live", async () => {
  const adapter = new WhatsAppAdapter();
  await assert.rejects(() => adapter.beginConnection({ method: "device-link" }), /CHANNEL_RISK_ACK/);
  const begun = await adapter.beginConnection({ method: "device-link", riskAck: true });
  assert.equal(begun.qr, false);
  assert.equal(begun.live, false);
  assert.equal((await adapter.health()).live, false);
  await assert.rejects(() => adapter.sendText({ text: "hi" }), /CHANNEL_NOT_LIVE:whatsapp/);
});
