import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import { wrapNative } from "./channel-bridge.js";

test("channel bridge drops incomplete inbound and HMAC-hashes peerRef", async () => {
  const key = randomBytes(32);
  const hashPeer = (senderId: string, accountRef: string) =>
    createHmac("sha256", key).update(`slack\0${accountRef}\0${senderId}`).digest("hex");
  const seen: unknown[] = [];
  let inbound: ((msg: Record<string, string>) => void) | undefined;
  const native = {
    async beginConnection() {
      return { kind: "token" as const, live: false as const, operationId: "op" };
    },
    async pollConnection() {
      return { status: "connected" };
    },
    health() {
      return { channel: "slack" as const, live: false, connection: "connected" };
    },
    async sendText() {
      return { delivered: true as const };
    },
    async disconnect() {},
    onInbound(handler: (msg: Record<string, string>) => void) {
      inbound = handler;
    },
  };
  const adapter = wrapNative("slack", native, { hashPeer });
  adapter.onInbound((event) => seen.push(event));
  inbound?.({ text: "hi" });
  inbound?.({ messageId: "1", senderId: "U1", channelId: "D1", text: "hello" });
  inbound?.({ messageId: "2", senderId: "U1", channelId: "D1", chatType: "private", text: "no-account" });
  inbound?.({
    messageId: "3",
    senderId: "U1",
    channelId: "D1",
    chatType: "private",
    botId: "B1",
    text: "hello",
  });
  assert.equal(seen.length, 1);
  const event = seen[0] as {
    peerRef: string;
    vendorTarget: string;
    vendorMessageId: string;
    accountRef: string;
    provenPrivate: true;
    idempotencyKey: string;
  };
  assert.equal(event.vendorMessageId, "3");
  assert.equal(event.vendorTarget, "D1");
  assert.equal(event.accountRef, "B1");
  assert.equal(event.provenPrivate, true);
  assert.equal(event.idempotencyKey, "slack:B1:3");
  assert.equal(event.peerRef, hashPeer("U1", "B1"));
  assert.notEqual(event.peerRef, hashPeer("U1", "B2"));
  assert.notEqual(event.peerRef, "U1");
  assert.equal(event.peerRef.length, 64);
});

test("wrapNative keeps enable separate from transport connected", async () => {
  const native = {
    async beginConnection() {
      return { kind: "token" as const, live: false as const, operationId: "op" };
    },
    async pollConnection() {
      return { status: "connected" };
    },
    health() {
      return { channel: "slack" as const, live: false, enabled: true, connection: "connected" };
    },
    async sendText() {
      return { delivered: true as const };
    },
    async disconnect() {},
  };
  const adapter = wrapNative("slack", native, { hashPeer: (senderId) => senderId });
  assert.equal((await adapter.health()).enabled, false);
  assert.equal((await adapter.health()).connection, "disabled");
  await adapter.enable();
  assert.equal((await adapter.health()).enabled, true);
  assert.equal((await adapter.health()).connection, "connected");
  await adapter.disable();
  assert.equal((await adapter.health()).enabled, false);
  assert.equal((await adapter.health()).connection, "disabled");
});
