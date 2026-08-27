import assert from "node:assert/strict";
import test from "node:test";
import { SlackAdapter } from "./index.js";

test("Slack validates a bot token without QR and can send", async () => {
  const adapter = new SlackAdapter(
    { resolve: () => ({ botToken: "xoxb-test", appToken: "xapp-test" }) },
    async (url) => {
      if (String(url).includes("auth.test")) return new Response(JSON.stringify({ ok: true, user_id: "U0", bot_id: "B1" }));
      if (String(url).includes("apps.connections.open")) return new Response(JSON.stringify({ ok: true, url: "wss://wss-primary.slack.com/link" }));
      if (String(url).includes("chat.postMessage")) return new Response(JSON.stringify({ ok: true }));
      return new Response("{}", { status: 404 });
    },
    {
      open: (_url, onEvent) => {
        onEvent({ type: "hello" });
        return { close() {} };
      },
    },
  );
  await assert.rejects(() => adapter.beginConnection({ method: "qr", credentialRef: "PENGLAI_SLACK_BOT" }), /CHANNEL_NO_QR/);
  const begun = await adapter.beginConnection({ method: "token", credentialRef: "PENGLAI_SLACK_BOT" });
  assert.equal(adapter.health().connection, "connected");
  assert.equal(begun.kind, "token");
  assert.equal(begun.live, false);
  await adapter.sendText({ text: "hi", peerRef: "D123" });
});

test("Slack ingest only accepts private IM events", async () => {
  const received: string[] = [];
  const adapter = new SlackAdapter({ resolve: () => ({ botToken: "xoxb-test" }) }, async () => new Response(JSON.stringify({ ok: true })));
  adapter.accountRef = "B1";
  adapter.onInbound((msg) => received.push(msg.text));
  adapter.ingestEvent({ type: "message", channel: "D1", channel_type: "im", text: "hi", user: "U1", ts: "1.0" });
  adapter.ingestEvent({ type: "message", channel: "D1", text: "no-type", user: "U1", ts: "1.1" });
  adapter.ingestEvent({ type: "message", channel: "C1", channel_type: "channel", text: "channel", user: "U1", ts: "2.0" });
  adapter.ingestEvent({ type: "message", channel: "D2", channel_type: "im", text: "missing-id", user: "U1" });
  adapter.ingestEvent({ type: "message", channel: "D3", channel_type: "im", text: "thread", user: "U1", ts: "3.0", thread_ts: "1.0" });
  assert.deepEqual(received, ["hi"]);
});

test("Slack Socket Mode reconnects after a transport close", async () => {
  let opened = 0;
  const adapter = new SlackAdapter(
    { resolve: () => ({ botToken: "xoxb-test", appToken: "xapp-test" }) },
    async (url) => {
      if (String(url).includes("auth.test")) return new Response(JSON.stringify({ ok: true, bot_id: "B1" }));
      if (String(url).includes("apps.connections.open")) {
        opened += 1;
        return new Response(JSON.stringify({ ok: true, url: "wss://wss-primary.slack.com/link" }));
      }
      if (String(url).includes("reactions.add")) return new Response(JSON.stringify({ ok: true }));
      return new Response("{}", { status: 404 });
    },
    {
      open: (_url, onEvent) => {
        onEvent({ type: "hello" });
        return { close() {} };
      },
    },
  );
  await adapter.beginConnection({ method: "token", credentialRef: "PENGLAI_SLACK_BOT" });
  assert.equal(opened, 1);
  adapter.notifySocketClosed();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  assert.equal(opened >= 2, true);
  await adapter.react({
    vendorTarget: "D1",
    vendorMessageId: "1.0",
    emoji: "eyes",
    action: "add",
    signal: AbortSignal.timeout(1_000),
  });
  await adapter.disconnect();
});
