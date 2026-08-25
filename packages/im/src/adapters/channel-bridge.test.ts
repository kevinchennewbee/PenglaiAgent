import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import { wrapNative } from "./channel-bridge.js";

test("channel bridge drops incomplete inbound and HMAC-hashes peerRef", async () => {
  const key = randomBytes(32);
  const hashPeer = (senderId: string) =>
    createHmac("sha256", key).update(`slack\0slack-default\0${senderId}`).digest("hex");
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
  assert.equal(seen.length, 1);
  const event = seen[0] as { peerRef: string; vendorTarget: string; vendorMessageId: string };
  assert.equal(event.vendorMessageId, "1");
  assert.equal(event.vendorTarget, "D1");
  assert.equal(event.peerRef, hashPeer("U1"));
  assert.notEqual(event.peerRef, "U1");
  assert.equal(event.peerRef.length, 64);
});
