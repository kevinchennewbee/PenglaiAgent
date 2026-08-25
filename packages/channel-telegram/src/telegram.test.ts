import assert from "node:assert/strict";
import test from "node:test";
import { TelegramAdapter } from "./index.js";

test("Telegram validates a bot token, flags webhook conflict, and refuses QR", async () => {
  const adapter = new TelegramAdapter(
    { resolve: () => ({ token: "123:abc" }) },
    async (url) => {
      const href = String(url);
      if (href.endsWith("/getMe")) return new Response(JSON.stringify({ ok: true, result: { id: 1 } }));
      if (href.endsWith("/getWebhookInfo")) return new Response(JSON.stringify({ ok: true, result: { url: "https://example.invalid/hook" } }));
      if (href.endsWith("/sendMessage")) return new Response(JSON.stringify({ ok: true }));
      return new Response("{}", { status: 404 });
    },
  );
  await assert.rejects(() => adapter.beginConnection({ method: "qr", credentialRef: "PENGLAI_TELEGRAM_TOKEN" }), /CHANNEL_NO_QR/);
  await adapter.beginConnection({ method: "token", credentialRef: "PENGLAI_TELEGRAM_TOKEN" });
  assert.equal(adapter.health().webhookConflict, true);
  await adapter.sendText({ text: "hi", peerRef: "1" });
});
