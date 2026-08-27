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
  assert.equal(a.idempotencyKey, inboundIdempotencyKey("slack", "bot-a", "1"));
  assert.notEqual(a.idempotencyKey, b.idempotencyKey);
  assert.notEqual(a.peerRef, b.peerRef);
  assert.equal(a.peerRef, hashPeer("U1", "bot-a"));
  const waOnce = parseInboundEnvelope(
    "whatsapp",
    { messageId: "wamid-1", senderId: "15557654321@s.whatsapp.net", chatId: "15557654321@s.whatsapp.net", chatType: "private", accountRef: "15551234567@s.whatsapp.net", text: "hi" },
    hashPeer,
  );
  assert.equal(waOnce.idempotencyKey, inboundIdempotencyKey("whatsapp", "15551234567@s.whatsapp.net", "wamid-1"));
  assert.equal(
    parseInboundEnvelope(
      "whatsapp",
      { messageId: "wamid-1", senderId: "15557654321@s.whatsapp.net", chatId: "15557654321@s.whatsapp.net", chatType: "private", accountRef: "15551234567@s.whatsapp.net", text: "hi" },
      hashPeer,
    ).idempotencyKey,
    waOnce.idempotencyKey,
  );
  assert.throws(
    () => parseInboundEnvelope("slack", { ...base, accountRef: "bot-a", thread: "123.4" }, hashPeer),
    (error: unknown) => error instanceof PenglaiError && error.message === "CHAT_SCOPE_UNSUPPORTED",
  );
});
