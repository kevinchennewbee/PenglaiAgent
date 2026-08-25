import assert from "node:assert/strict";
import test from "node:test";
import { SlackAdapter } from "./index.js";

test("Slack validates a bot token without QR and can send", async () => {
  const adapter = new SlackAdapter(
    { resolve: () => ({ botToken: "xoxb-test", appToken: "xapp-test" }) },
    async (url) => {
      if (String(url).includes("auth.test")) return new Response(JSON.stringify({ ok: true }));
      if (String(url).includes("chat.postMessage")) return new Response(JSON.stringify({ ok: true }));
      return new Response("{}", { status: 404 });
    },
  );
  await assert.rejects(() => adapter.beginConnection({ method: "qr", credentialRef: "PENGLAI_SLACK_BOT" }), /CHANNEL_NO_QR/);
  const begun = await adapter.beginConnection({ method: "token", credentialRef: "PENGLAI_SLACK_BOT" });
  assert.equal(begun.kind, "token");
  assert.equal(begun.live, false);
  await adapter.sendText({ text: "hi", peerRef: "D123" });
});

test("Slack ingest only accepts private IM events", async () => {
  const received: string[] = [];
  const adapter = new SlackAdapter({ resolve: () => ({ botToken: "xoxb-test" }) }, async () => new Response(JSON.stringify({ ok: true })));
  adapter.onInbound((msg) => received.push(msg.text));
  adapter.ingestEvent({ type: "message", channel: "D1", text: "hi", user: "U1", ts: "1.0" });
  adapter.ingestEvent({ type: "message", channel: "C1", text: "channel", user: "U1", ts: "2.0" });
  assert.deepEqual(received, ["hi"]);
});
