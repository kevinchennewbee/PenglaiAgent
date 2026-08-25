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
  );
  await assert.rejects(() => adapter.beginConnection({ method: "qr", credentialRef: "PENGLAI_DISCORD_TOKEN" }), /CHANNEL_NO_QR/);
  const begun = await adapter.beginConnection({ method: "token", credentialRef: "PENGLAI_DISCORD_TOKEN" });
  assert.equal(begun.kind, "token");
  await adapter.sendText({ text: "hi", peerRef: "c1" });
});
