import assert from "node:assert/strict";
import test from "node:test";
import { DiscordAdapter, DISCORD_GATEWAY_INTENTS } from "./index.js";

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
  adapter.accountRef = "bot-1";
  adapter.onInbound((msg) => seen.push(msg));
  adapter.ingestMessage({ id: "1", content: "hi", author: { id: "u1" } });
  adapter.ingestMessage({ content: "hi", channel_id: "c1", author: { id: "u1" } });
  adapter.ingestMessage({ id: "2", content: "hi", channel_id: "c1", author: { id: "u1", bot: true } });
  adapter.ingestMessage({ id: "3", content: "hi", channel_id: "c1", author: { id: "u1" }, guild_id: "g1" });
  adapter.ingestMessage({ id: "4", content: "unknown", channel_id: "unknown", author: { id: "u1" } });
  adapter.ingestMessage({ id: "4", content: "hi", channel_id: "c1", channel_type: 1, author: { id: "u1" } });
  adapter.ingestMessage({ id: "5", content: "gdm", channel_id: "gdm1", author: { id: "u1" }, channel_type: 3 });
  assert.equal(seen.length, 1);
});

test("Discord Gateway requests DM-only intent and handles resume opcodes", async () => {
  assert.equal(DISCORD_GATEWAY_INTENTS, 1 << 12);
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    readyState = 1;
    sent: unknown[] = [];
    private readonly listeners = new Map<string, Array<(ev: { data?: unknown; code?: number }) => void>>();
    constructor(public url: string) {
      sockets.push(this);
    }
    addEventListener(type: string, listener: (ev: { data?: unknown; code?: number }) => void) {
      const list = this.listeners.get(type) ?? [];
      list.push(listener);
      this.listeners.set(type, list);
    }
    send(data: string) {
      this.sent.push(JSON.parse(data));
    }
    close(code = 4000) {
      this.readyState = 3;
      for (const listener of this.listeners.get("close") ?? []) listener({ code });
    }
    emit(type: string, ev: { data?: unknown; code?: number }) {
      for (const listener of this.listeners.get(type) ?? []) listener(ev);
    }
  }
  const adapter = new DiscordAdapter(
    { resolve: () => ({ token: "bot-token" }) },
    async (url) => {
      if (String(url).endsWith("/users/@me")) return new Response(JSON.stringify({ id: "bot-1" }));
      if (String(url).includes("/gateway")) return new Response(JSON.stringify({ url: "wss://gateway.discord.gg" }));
      if (String(url).endsWith("/channels/dm1")) return new Response(JSON.stringify({ id: "dm1", type: 1 }));
      if (String(url).endsWith("/channels/gdm1")) return new Response(JSON.stringify({ id: "gdm1", type: 3 }));
      if (String(url).includes("/reactions/")) return new Response(null, { status: 204 });
      return new Response("{}", { status: 404 });
    },
    { createWebSocket: (url) => new FakeSocket(url) },
  );
  const pending = adapter.beginConnection({ method: "token", credentialRef: "PENGLAI_DISCORD_TOKEN" });
  for (let i = 0; i < 50 && !sockets[0]; i += 1) await Promise.resolve();
  const ws = sockets[0];
  assert.ok(ws);
  assert.equal(ws.url, "wss://gateway.discord.gg/?v=10&encoding=json");
  ws.emit("message", { data: JSON.stringify({ op: 10, d: { heartbeat_interval: 45_000 } }) });
  const identify = ws.sent.find((row) => (row as { op?: number }).op === 2) as { d?: { intents?: number } };
  assert.equal(identify?.d?.intents, DISCORD_GATEWAY_INTENTS);
  ws.emit("message", { data: JSON.stringify({ op: 0, t: "READY", d: { session_id: "s1", resume_gateway_url: "wss://resume.discord.gg" }, s: 1 }) });
  await pending;
  const inbound: unknown[] = [];
  adapter.onInbound((message) => inbound.push(message));
  ws.emit("message", { data: JSON.stringify({ op: 0, t: "MESSAGE_CREATE", d: { id: "m1", channel_id: "dm1", content: "private", author: { id: "u1" } }, s: 2 }) });
  ws.emit("message", { data: JSON.stringify({ op: 0, t: "MESSAGE_CREATE", d: { id: "m2", channel_id: "gdm1", content: "group", author: { id: "u1" } }, s: 3 }) });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(inbound.length, 1);
  ws.emit("message", { data: JSON.stringify({ op: 1 }) });
  assert.equal(ws.sent.some((row) => (row as { op?: number }).op === 1), true);
  ws.emit("message", { data: JSON.stringify({ op: 11 }) });
  await adapter.react({
    vendorTarget: "c1",
    vendorMessageId: "m1",
    emoji: "✅",
    action: "add",
    signal: AbortSignal.timeout(1_000),
  });
  ws.emit("message", { data: JSON.stringify({ op: 7 }) });
  assert.equal(ws.readyState, 3);
  await adapter.disconnect();
});
