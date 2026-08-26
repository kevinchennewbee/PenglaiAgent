import assert from "node:assert/strict";
import test from "node:test";
import {
  LID_PRIVATE_SUPPORTED,
  PINNED_BAILEYS,
  classifyWhatsAppPeerJid,
  extractWhatsAppInbound,
  ingestBaileysUpsert,
  selfAccountJid,
} from "./inbound-jid.js";

const SELF = "15551234567@s.whatsapp.net";
const PEER = "15557654321@s.whatsapp.net";
const PEER2 = "15550001111@s.whatsapp.net";
const LID = "123456789012345@lid";

function upsert(
  remoteJid: string,
  text: string,
  extra?: { id?: string; fromMe?: boolean; captionKind?: "image" | "document" | "video" | "reaction" },
) {
  const id = extra?.id ?? "mid-1";
  const payload =
    extra?.captionKind === "image"
      ? { imageMessage: { caption: text } }
      : extra?.captionKind === "document"
        ? { documentMessage: { caption: text } }
        : extra?.captionKind === "video"
          ? { videoMessage: { caption: text } }
          : extra?.captionKind === "reaction"
            ? { reactionMessage: { text } }
            : { conversation: text };
  return {
    key: { id, fromMe: extra?.fromMe === true, remoteJid },
    message: payload,
  };
}

test("pinned Baileys 7.0.0-rc14 documents LID private users", () => {
  assert.equal(PINNED_BAILEYS, "7.0.0-rc14");
  assert.equal(LID_PRIVATE_SUPPORTED, true);
  assert.equal(classifyWhatsAppPeerJid(LID).kind, "private");
});

test("private PN and LID ingest once with stable self accountRef", () => {
  const seen: unknown[] = [];
  ingestBaileysUpsert(
    { messages: [upsert(PEER, "hello"), upsert(LID, "lid-hi", { id: "mid-2" })] },
    { accountJid: SELF, isEcho: () => false, onMessage: (msg) => seen.push(msg) },
  );
  assert.equal(seen.length, 2);
  const first = seen[0] as { chatType: string; accountRef: string; senderId: string };
  const second = seen[1] as { accountRef: string; senderId: string };
  assert.equal(first.chatType, "private");
  assert.equal(first.accountRef, SELF);
  assert.equal(first.senderId, PEER);
  assert.equal(second.accountRef, SELF);
  assert.equal(second.senderId, LID);
});

test("two peers share one stable self accountRef", () => {
  const a = extractWhatsAppInbound({
    message: upsert(PEER, "a"),
    accountJid: SELF,
    isEcho: () => false,
  });
  const b = extractWhatsAppInbound({
    message: upsert(PEER2, "b", { id: "mid-2" }),
    accountJid: SELF,
    isEcho: () => false,
  });
  assert.equal(a?.accountRef, SELF);
  assert.equal(b?.accountRef, SELF);
  assert.equal(a?.senderId, PEER);
  assert.equal(b?.senderId, PEER2);
  assert.notEqual(a?.senderId, a?.accountRef);
});

test("group broadcast status newsletter and unknown JIDs never emit private", () => {
  const seen: unknown[] = [];
  const rejected = [
    upsert("120363@g.us", "group"),
    upsert("status@broadcast", "status"),
    upsert("123@broadcast", "broadcast"),
    upsert("123@newsletter", "news"),
    upsert("not-a-jid", "x"),
    upsert("13135550002@c.us", "bot"),
  ];
  ingestBaileysUpsert(
    { messages: rejected },
    { accountJid: SELF, isEcho: () => false, onMessage: (msg) => seen.push(msg) },
  );
  assert.equal(seen.length, 0);
  for (const row of rejected) {
    const extracted = extractWhatsAppInbound({ message: row, accountJid: SELF, isEcho: () => false });
    assert.equal(extracted, undefined);
    assert.notEqual(classifyWhatsAppPeerJid(row.key.remoteJid).kind, "private");
  }
});

test("missing self identity never calls onMessage and does not fall back to the peer", () => {
  let called = 0;
  ingestBaileysUpsert(
    { messages: [upsert(PEER, "hello")] },
    { accountJid: undefined, isEcho: () => false, onMessage: () => {
      called += 1;
    } },
  );
  assert.equal(called, 0);
  assert.equal(selfAccountJid({}), undefined);
  assert.equal(selfAccountJid({ me: {} }), undefined);
  assert.equal(extractWhatsAppInbound({ message: upsert(PEER, "hello"), accountJid: undefined, isEcho: () => false }), undefined);
});

test("captions use the same private gate; reaction-only and group captions do not emit", () => {
  const image = extractWhatsAppInbound({
    message: upsert(PEER, "photo", { captionKind: "image" }),
    accountJid: SELF,
    isEcho: () => false,
  });
  assert.equal(image?.text, "photo");
  assert.equal(image?.chatType, "private");
  assert.equal(
    extractWhatsAppInbound({
      message: upsert("120363@g.us", "photo", { captionKind: "image" }),
      accountJid: SELF,
      isEcho: () => false,
    }),
    undefined,
  );
  assert.equal(
    extractWhatsAppInbound({
      message: upsert(PEER, "👍", { captionKind: "reaction" }),
      accountJid: SELF,
      isEcho: () => false,
    }),
    undefined,
  );
  assert.equal(
    extractWhatsAppInbound({
      message: upsert("120363@g.us", "👍", { captionKind: "reaction" }),
      accountJid: SELF,
      isEcho: () => false,
    }),
    undefined,
  );
});

test("echo and fromMe messages are dropped before onMessage", () => {
  const seen: string[] = [];
  ingestBaileysUpsert(
    { messages: [upsert(PEER, "echo", { id: "wa-1" }), upsert(PEER, "me", { fromMe: true, id: "mid-me" })] },
    {
      accountJid: SELF,
      isEcho: (id) => id === "wa-1",
      onMessage: (msg) => seen.push(msg.messageId),
    },
  );
  assert.deepEqual(seen, []);
});
