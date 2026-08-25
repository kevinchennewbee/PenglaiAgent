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
  await assert.rejects(() => adapter.beginConnection({ method: "token", credentialRef: "PENGLAI_TELEGRAM_TOKEN" }), /TELEGRAM_WEBHOOK_CONFLICT/);
  assert.equal(adapter.health().webhookConflict, true);
});

test("Telegram long-polls after getMe when no webhook is set", async () => {
  const adapter = new TelegramAdapter(
    { resolve: () => ({ token: "123:abc" }) },
    async (url) => {
      const href = String(url);
      if (href.includes("/getMe")) return new Response(JSON.stringify({ ok: true, result: { id: 1 } }));
      if (href.includes("/getWebhookInfo")) return new Response(JSON.stringify({ ok: true, result: { url: "" } }));
      if (href.includes("/sendMessage")) return new Response(JSON.stringify({ ok: true }));
      if (href.includes("/getUpdates")) return new Response(JSON.stringify({ ok: true, result: [] }));
      return new Response("{}", { status: 404 });
    },
  );
  await adapter.beginConnection({ method: "token", credentialRef: "PENGLAI_TELEGRAM_TOKEN" });
  await adapter.sendText({ text: "hi", peerRef: "1" });
  await adapter.disconnect();
});

test("Telegram ingest only accepts private text", async () => {
  const received: string[] = [];
  const adapter = new TelegramAdapter({ resolve: () => ({ token: "123:abc" }) }, async () => new Response("{}", { status: 404 }));
  adapter.onInbound((msg) => received.push(msg.text));
  adapter.ingestUpdate({
    update_id: 2,
    message: { message_id: 9, text: "hello", chat: { id: 11, type: "private" }, from: { id: 11 } },
  });
  adapter.ingestUpdate({
    update_id: 3,
    message: { message_id: 10, text: "group", chat: { id: -1, type: "group" }, from: { id: 11 } },
  });
  adapter.ingestUpdate({
    update_id: 4,
    message: { text: "noid", chat: { id: 11, type: "private" }, from: { id: 11 } },
  });
  assert.deepEqual(received, ["hello"]);
});
