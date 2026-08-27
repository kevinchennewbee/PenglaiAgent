import assert from "node:assert/strict";
import test from "node:test";
import { WhatsAppAdapter } from "./whatsapp.js";

test("WhatsApp compatibility shell cannot start an unbundled runtime", async () => {
  const adapter = new WhatsAppAdapter();
  await assert.rejects(
    () => adapter.beginConnection({ method: "device-link", riskAck: true }),
    /CHANNEL_RUNTIME_NOT_BUNDLED:whatsapp/,
  );
  assert.equal((await adapter.health()).live, false);
  assert.equal((await adapter.health()).enabled, false);
  await assert.rejects(() => adapter.sendText({ text: "hi" }), /CHANNEL_NOT_LIVE:whatsapp/);
});
