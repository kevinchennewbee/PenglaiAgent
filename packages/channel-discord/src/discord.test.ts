import assert from "node:assert/strict";
import test from "node:test";
import { DiscordAdapter } from "./index.js";

test("Discord validates a bot token without QR", async () => {
  const adapter = new DiscordAdapter(
    { resolve: () => ({ token: "bot-token" }) },
    async (url, init) => {
      if (String(url).endsWith("/users/@me")) return new Response(JSON.stringify({ id: "1" }));
      if (String(url).includes("/messages") && init?.method === "POST") return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
      return new Response("{}", { status: 404 });
    },
    { connect: () => ({ close() {} }) },
  );
  await assert.rejects(() => adapter.beginConnection({ method: "qr", credentialRef: "PENGLAI_DISCORD_TOKEN" }), /CHANNEL_NO_QR/);
  const begun = await adapter.beginConnection({ method: "token", credentialRef: "PENGLAI_DISCORD_TOKEN" });
  assert.equal(begun.kind, "token");
  await adapter.sendText({ text: "hi", peerRef: "c1" });
});

test("Discord ingest drops guild, bots, and incomplete identities", async () => {
  const adapter = new DiscordAdapter({ resolve: () => ({ token: "bot-token" }) });
  const seen: unknown[] = [];
  adapter.onInbound((msg) => seen.push(msg));
  adapter.ingestMessage({ id: "1", content: "hi", author: { id: "u1" } });
  adapter.ingestMessage({ content: "hi", channel_id: "c1", author: { id: "u1" } });
  adapter.ingestMessage({ id: "2", content: "hi", channel_id: "c1", author: { id: "u1", bot: true } });
  adapter.ingestMessage({ id: "3", content: "hi", channel_id: "c1", author: { id: "u1" }, guild_id: "g1" });
  adapter.ingestMessage({ id: "4", content: "hi", channel_id: "c1", author: { id: "u1" } });
  assert.equal(seen.length, 1);
});
