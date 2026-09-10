import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import {
  channelConfigAccountId,
  inboundIdempotencyKey,
  isForbiddenDefaultAccount,
  parseInboundEnvelope,
  tryParseInboundEnvelope,
} from "./inbound-envelope.js";

const key = randomBytes(32);
const hashPeer = (senderId: string, accountRef: string) =>
  createHmac("sha256", key).update(`slack\0${accountRef}\0${senderId}`).digest("hex");

test("inbound envelope rejects missing unknown and group chatType", () => {
  assert.deepEqual(
    tryParseInboundEnvelope("slack", { messageId: "1", senderId: "U1", channelId: "D1", botId: "B1", text: "hi" }, hashPeer),
    { reject: "UNKNOWN_CHAT_TYPE" },
  );
  assert.deepEqual(
    tryParseInboundEnvelope(
      "slack",
      { messageId: "1", senderId: "U1", channelId: "D1", botId: "B1", chatType: "im", text: "hi" },
      hashPeer,
    ),
    { reject: "UNKNOWN_CHAT_TYPE" },
  );
  assert.deepEqual(
    tryParseInboundEnvelope(
      "slack",
      { messageId: "1", senderId: "U1", channelId: "D1", botId: "B1", chatType: "group", text: "hi" },
      hashPeer,
    ),
    { reject: "CHAT_TYPE_UNSUPPORTED" },
  );
  assert.deepEqual(
    tryParseInboundEnvelope(
      "discord",
      { messageId: "1", senderId: "U1", channelId: "C1", botId: "B1", chatType: "thread", text: "hi" },
      hashPeer,
    ),
    { reject: "CHAT_TYPE_UNSUPPORTED" },
  );
});

test("inbound envelope rejects the unscoped iMessage default account", () => {
  assert.equal(isForbiddenDefaultAccount("imessage", "imessage-default"), true);
  assert.equal(isForbiddenDefaultAccount("imessage", "macos-messages"), false);
  assert.deepEqual(
    tryParseInboundEnvelope(
      "imessage",
      {
        messageId: "1",
        senderId: "a@example.com",
        chatId: "any;-;a@example.com",
        botId: "imessage-default",
        chatType: "private",
        text: "hi",
      },
      hashPeer,
    ),
    { reject: "LEGACY_DEFAULT_ACCOUNT" },
  );
});

test("inbound envelope rejects missing accountRef and the legacy default identity", () => {
  assert.deepEqual(
    tryParseInboundEnvelope(
      "slack",
      { messageId: "1", senderId: "U1", channelId: "D1", chatType: "private", text: "hi" },
      hashPeer,
    ),
    { reject: "ACCOUNT_REF_REQUIRED" },
  );
  assert.deepEqual(
    tryParseInboundEnvelope(
      "slack",
      { messageId: "1", senderId: "U1", channelId: "D1", botId: "slack-default", chatType: "private", text: "hi" },
      hashPeer,
    ),
    { reject: "LEGACY_DEFAULT_ACCOUNT" },
  );
  assert.equal(isForbiddenDefaultAccount("slack", "slack-default"), true);
  assert.equal(channelConfigAccountId("slack"), "cfg:slack");
});

test("inbound envelope HMAC and idempotency are isolated by channel plus account", () => {
  const base = { messageId: "1", senderId: "U1", channelId: "D1", chatType: "private", text: "hi" };
  const a = parseInboundEnvelope("slack", { ...base, accountRef: "bot-a" }, hashPeer);
  const b = parseInboundEnvelope("slack", { ...base, accountRef: "bot-b" }, hashPeer);
  assert.equal(a.provenPrivate, true);
  assert.equal(a.chatType, "private");
  assert.equal(a.idempotencyKey, inboundIdempotencyKey("slack", "bot-a", "1", "D1"));
  assert.notEqual(a.idempotencyKey, b.idempotencyKey);
  assert.notEqual(a.peerRef, b.peerRef);
  assert.equal(a.peerRef, hashPeer("U1", "bot-a"));
  const telegramOnce = parseInboundEnvelope(
    "telegram",
    { messageId: "update-1", senderId: "user-1", chatId: "chat-1", chatType: "private", accountRef: "bot-1", text: "hi" },
    hashPeer,
  );
  assert.equal(telegramOnce.idempotencyKey, inboundIdempotencyKey("telegram", "bot-1", "update-1", "chat-1"));
  assert.equal(
    parseInboundEnvelope(
      "telegram",
      { messageId: "update-1", senderId: "user-1", chatId: "chat-1", chatType: "private", accountRef: "bot-1", text: "hi" },
      hashPeer,
    ).idempotencyKey,
    telegramOnce.idempotencyKey,
  );
  assert.throws(
    () => parseInboundEnvelope("slack", { ...base, accountRef: "bot-a", thread: "123.4" }, hashPeer),
    (error: unknown) => error instanceof PenglaiError && error.message === "CHAT_SCOPE_UNSUPPORTED",
  );
});

test("same vendor message ID in different private chats has distinct durable operation identity", async () => {
  const { inboundOperationKey } = await import("./inbound-envelope.js");
  const { Store } = await import("@penglai/persistence");
  const store = new Store(":memory:");
  for (const routeId of ["chat-a", "chat-b"]) store.upsertRoute({ routeId, adapter: "telegram", accountRef: "bot", peerRef: routeId, status: "active" });
  const { inboundIdempotencyKey: keyed } = await import("./inbound-envelope.js");
  const chatA = keyed("telegram", "bot", "1", "chat-a");
  const chatB = keyed("telegram", "bot", "1", "chat-b");
  assert.notEqual(chatA, chatB);
  const vendorMessageKey = "telegram:bot:1";
  const legacy = store.claimInboundOperation({ operationId: `op:${vendorMessageKey}`, routeId: "chat-a", vendorMessageKey });
  const replay = store.claimInboundOperation({ operationId: inboundOperationKey("chat-a", vendorMessageKey), routeId: "chat-a", vendorMessageKey });
  assert.equal(replay.created, false);
  assert.equal(replay.operationId, legacy.operationId);
  const migrated = store.claimInboundOperation({ operationId: inboundOperationKey("chat-a", vendorMessageKey), routeId: "chat-a", vendorMessageKey });
  assert.equal(migrated.created, false);
  assert.equal(migrated.operationId, legacy.operationId);
  const other = store.claimInboundOperation({ operationId: inboundOperationKey("chat-b", chatB), routeId: "chat-b", vendorMessageKey: chatB });
  assert.equal(other.created, true);
  assert.notEqual(other.operationId, legacy.operationId);
  store.close();
});
