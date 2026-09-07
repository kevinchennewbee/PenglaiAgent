import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { OfficialImRequestStore } from "./official-requests.js";

function store() {
  const db = new DatabaseSync(":memory:");
  return { db, requests: new OfficialImRequestStore(db) };
}

test("official IM requests reject expiry, replay, and a different account or sender", () => {
  const { requests } = store();
  const created = requests.create({
    channel: "weixin",
    accountId: "acct-a",
    peerId: "peer-owner",
    kind: "approval",
    prompt: "Allow office save?",
    objectId: "office-job-1",
    ttlMs: 1_000,
    cardToken: "card-1",
    now: 1_000,
  });
  assert.equal(created.state, "open");
  assert.throws(
    () => requests.answer({
      requestId: created.requestId,
      channel: "weixin",
      accountId: "acct-b",
      peerId: "peer-owner",
      text: "yes",
      cardToken: "card-1",
      now: 1_100,
    }),
    /OFFICIAL_REQUEST_PEER/,
  );
  assert.throws(
    () => requests.answer({
      requestId: created.requestId,
      channel: "weixin",
      accountId: "acct-a",
      peerId: "attacker",
      text: "yes",
      cardToken: "card-1",
      now: 1_100,
    }),
    /OFFICIAL_REQUEST_PEER/,
  );
  assert.throws(
    () => requests.answer({
      requestId: created.requestId,
      channel: "weixin",
      accountId: "acct-a",
      peerId: "peer-owner",
      text: "yes",
      cardToken: "other-card",
      now: 1_100,
    }),
    /OFFICIAL_REQUEST_CARD/,
  );
  const answered = requests.answer({
    requestId: created.requestId,
    channel: "weixin",
    accountId: "acct-a",
    peerId: "peer-owner",
    text: "yes",
    cardToken: "card-1",
    now: 1_100,
  });
  assert.equal(answered.state, "answered");
  assert.throws(
    () => requests.answer({
      requestId: created.requestId,
      channel: "weixin",
      accountId: "acct-a",
      peerId: "peer-owner",
      text: "yes again",
      cardToken: "card-1",
      now: 1_200,
    }),
    /OFFICIAL_REQUEST_REPLAY/,
  );
  const expired = requests.create({
    channel: "feishu",
    accountId: "acct-a",
    peerId: "peer-owner",
    kind: "question",
    prompt: "Which file?",
    objectId: "ask-1",
    ttlMs: 50,
    now: 2_000,
  });
  assert.throws(
    () => requests.answer({
      requestId: expired.requestId,
      channel: "feishu",
      accountId: "acct-a",
      peerId: "peer-owner",
      text: "notes.docx",
      now: 2_100,
    }),
    /OFFICIAL_REQUEST_EXPIRED/,
  );
});

test("inbound text from the bound peer answers the open official request and is not a DSH turn", () => {
  const { requests } = store();
  const created = requests.create({
    channel: "weixin",
    accountId: "acct-a",
    peerId: "peer-owner",
    kind: "question",
    prompt: "Confirm?",
    objectId: "ask-2",
    now: 5_000,
  });
  const reply = requests.tryAnswerFromInbound({
    channel: "weixin",
    accountId: "acct-a",
    peerId: "peer-owner",
    text: "confirmed",
    now: 5_100,
  });
  assert.match(String(reply), new RegExp(created.requestId));
  assert.equal(requests.get(created.requestId)?.state, "answered");
  assert.equal(
    requests.tryAnswerFromInbound({
      channel: "weixin",
      accountId: "acct-a",
      peerId: "stranger",
      text: "confirmed",
      now: 5_200,
    }),
    undefined,
  );
});
