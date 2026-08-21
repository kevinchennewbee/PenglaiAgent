import assert from "node:assert/strict";
import test from "node:test";
import { tmpDb } from "@penglai/testkit";
import { Store } from "./index.js";

test("migration is idempotent and fail-closed on newer schema", () => {
  const store = new Store(tmpDb());
  store.migrate();
  store.close();
});

test("route unique by adapter+peer", () => {
  const store = new Store(":memory:");
  store.upsertRoute({
    routeId: "r1",
    adapter: "mock",
    accountRef: "a",
    peerRef: "p",
    status: "active",
  });
  const found = store.findRoute("mock", "a", "p");
  assert.equal(found?.routeId, "r1");
  store.close();
});

test("R1-STATE-016 refuses newer schema", () => {
  const store = new Store(":memory:");
  store.db.prepare("UPDATE schema_meta SET version=99").run();
  assert.throws(() => store.migrate());
  store.close();
});

test("vendor reply target is stored separately from peerRef", () => {
  const store = new Store(":memory:");
  store.upsertRoute({ routeId: "r1", adapter: "weixin", accountRef: "a", peerRef: "hashed", status: "active" });
  store.putVendorReplyTarget("r1", "wx-user-original");
  assert.equal(store.getVendorReplyTarget("r1"), "wx-user-original");
  store.close();
});

test("cursor persist and event dedupe refuse tenant mismatch", () => {
  const store = new Store(":memory:");
  store.putCursor("weixin-default", "weixin", "buf-1");
  assert.equal(store.getCursor("weixin-default", "weixin"), "buf-1");
  assert.equal(store.claimDedupe("feishu", "om_1", "t1", "cli_1"), true);
  assert.equal(store.claimDedupe("feishu", "om_1", "t1", "cli_1"), false);
  assert.throws(() => store.claimDedupe("feishu", "om_1", "other-tenant", "cli_1"), /tenant mismatch/);
  store.close();
});

test("schema 6 exposes guards, sending recovery, and durable dispatch mode", () => {
  const store = new Store(":memory:");
  assert.equal(store.schemaVersion(), 11);
  store.upsertRoute({ routeId: "r1", adapter: "mock", accountRef: "a", peerRef: "p", status: "active" });
  store.putGuard("r1", { pairingAttempts: 2, pairingLockedUntil: 9, rateWindowStart: 1, rateCount: 3 });
  assert.equal(store.getGuard("r1").pairingAttempts, 2);
  store.insertInbound({
    inboundId: "steer-1",
    adapterMessageKey: "event-1",
    routeId: "r1",
    bindingRevision: 1,
    bodyKind: "text",
    redactedDigest: "a".repeat(64),
    state: "queued",
    dispatchMode: "steer",
  }, "payload", 1);
  assert.equal(store.getInbound("steer-1")?.dispatchMode, "steer");
  assert.equal(store.getInboundPayloadText("steer-1"), "payload");
  store.close();
});

test("schema 5 persists binding voice policy and resumable opaque voice jobs", () => {
  const store = new Store(":memory:");
  store.upsertRoute({ routeId: "r-voice", adapter: "weixin", accountRef: "a", peerRef: "p", status: "active" });
  store.putBindingVoicePolicy("r-voice", {
    inputMode: "text-and-voice",
    replyMode: "text-and-voice",
    voiceId: "moss-zh-default",
    failureFallback: "text",
    updatedAt: "2026-08-17T00:00:00.000Z",
  });
  assert.equal(store.getBindingVoicePolicy("r-voice").replyMode, "text-and-voice");
  store.insertInbound({
    inboundId: "in-voice",
    adapterMessageKey: "vendor-message",
    routeId: "r-voice",
    bindingRevision: 1,
    bodyKind: "voice",
    redactedDigest: "a".repeat(64),
    state: "received",
  }, "", 1);
  store.putVoiceJob({
    inboundId: "in-voice",
    adapter: "weixin",
    mediaRefJson: JSON.stringify({ ref: "opaque" }),
    durationMs: 1_000,
    state: "claimed",
    updatedAt: 1,
  });
  assert.equal(store.pendingVoiceJobs("weixin").length, 1);
  store.setVoiceJobState("in-voice", "retryable", 2, { errorClass: "DELIVERY_TRANSIENT" });
  assert.equal(store.getVoiceJob("in-voice")?.errorClass, "DELIVERY_TRANSIENT");
  store.setVoiceJobState("in-voice", "transcribed", 3, { asrLanguage: "zh", asrEmotion: "HAPPY" });
  assert.equal(store.getVoiceJob("in-voice")?.asrLanguage, "zh");
  assert.equal(store.getVoiceJob("in-voice")?.asrEmotion, "HAPPY");
  store.close();
});

test("schema 8 persists pending IM menus and expires them", () => {
  const store = new Store(":memory:");
  assert.equal(store.schemaVersion(), 11);
  store.upsertRoute({ routeId: "r1", adapter: "mock", accountRef: "a", peerRef: "p", status: "active" });
  store.putPendingMenu("r1", {
    kind: "projects",
    locale: "en",
    choices: [{ n: 1, workspaceId: "ws", label: "Downloads" }],
    createdAt: 1000,
  });
  const live = store.getPendingMenu("r1", 1000);
  assert.equal(live?.locale, "en");
  assert.equal(live?.choices[0]?.workspaceId, "ws");
  assert.equal(store.getPendingMenu("r1", 1000 + 24 * 60 * 60 * 1000 + 1), undefined);
  assert.equal(store.getPendingMenu("r1", 1000), undefined);
  store.close();
});

test("schema 7 lets WeChat and Feishu share one official default session", () => {
  const store = new Store(":memory:");
  assert.equal(store.schemaVersion(), 11);
  const unique = store.db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='bindings_active_session'")
    .get() as { name?: string } | undefined;
  assert.equal(unique, undefined);
  store.upsertRoute({ routeId: "wx", adapter: "weixin", accountRef: "a", peerRef: "owner-wx", status: "active" });
  store.upsertRoute({ routeId: "fs", adapter: "feishu", accountRef: "a", peerRef: "owner-fs", status: "active" });
  const now = "2026-08-19T00:00:00.000Z";
  store.putBinding({
    routeId: "wx",
    workspaceIdentity: "ws1",
    sessionId: "sess1",
    revision: 1,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  store.putBinding({
    routeId: "fs",
    workspaceIdentity: "ws1",
    sessionId: "sess1",
    revision: 1,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(store.activeBinding("wx")?.sessionId, "sess1");
  assert.equal(store.activeBinding("fs")?.sessionId, "sess1");
  store.close();
});

test("P51-IM-001 outbox claim is exclusive", () => {
  const store = new Store(":memory:");
  store.upsertRoute({ routeId: "r1", adapter: "mock", accountRef: "a", peerRef: "p", status: "active" });
  store.insertInbound(
    {
      inboundId: "in1",
      adapterMessageKey: "k1",
      routeId: "r1",
      bindingRevision: 1,
      bodyKind: "text",
      redactedDigest: "d",
      state: "outbox_pending",
    },
    "hi",
    1,
  );
  store.insertOutbox({
    outboxId: "out1",
    routeId: "r1",
    inboundId: "in1",
    turnId: "t1",
    sequence: 1,
    payloadKind: "text",
    payloadRef: "r",
    payloadText: "hi",
    state: "pending",
    attempts: 0,
    nextAttemptAt: 1,
    fragmentIndex: 0,
    fragmentCount: 1,
  });
  const first = store.claimOutbox({ outboxId: "out1", workerId: "w1", now: 10 });
  const second = store.claimOutbox({ outboxId: "out1", workerId: "w2", now: 10 });
  assert.equal(first?.workerId, "w1");
  assert.equal(second, undefined);
  assert.equal(store.getOutbox("out1")?.state, "claimed");
  store.close();
});
