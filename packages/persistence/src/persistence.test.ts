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

test("schema 12 keeps Weixin/Feishu routes and refuses duplicate vendor messages", () => {
  const store = new Store(":memory:");
  assert.equal(store.schemaVersion(), 12);
  store.upsertRoute({ routeId: "wx1", adapter: "weixin", accountRef: "a", peerRef: "p", status: "active" });
  const first = store.claimInboundOperation({
    operationId: "op-1",
    vendorMessageKey: "vendor-1",
    routeId: "wx1",
  });
  const again = store.claimInboundOperation({
    operationId: "op-2",
    vendorMessageKey: "vendor-1",
    routeId: "wx1",
  });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.operationId, "op-1");
  store.upsertRoute({
    routeId: "slack1",
    adapter: "slack",
    accountRef: "bot",
    peerRef: "user",
    status: "active",
  });
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
  assert.equal(store.schemaVersion(), 12);
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
  for (const [index, state] of ([
    "processing",
    "downloading",
    "validating",
    "transcoding",
    "transcribing",
    "retryable",
  ] as const).entries()) {
    store.setVoiceJobState("in-voice", state, index + 2);
    assert.equal(store.pendingVoiceJobs("weixin")[0]?.state, state);
  }
  store.setVoiceJobState("in-voice", "retryable", 8, { errorClass: "DELIVERY_TRANSIENT" });
  assert.equal(store.getVoiceJob("in-voice")?.errorClass, "DELIVERY_TRANSIENT");
  store.setVoiceJobState("in-voice", "transcribed", 9, { asrLanguage: "zh", asrEmotion: "HAPPY" });
  assert.equal(store.pendingVoiceJobs("weixin").length, 0);
  assert.equal(store.getVoiceJob("in-voice")?.asrLanguage, "zh");
  assert.equal(store.getVoiceJob("in-voice")?.asrEmotion, "HAPPY");
  store.setVoiceJobState("in-voice", "queued", 10);
  assert.equal(store.pendingVoiceJobs("weixin").length, 0);
  store.close();
});

test("schema 8 persists pending IM menus and expires them", () => {
  const store = new Store(":memory:");
  assert.equal(store.schemaVersion(), 12);
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
  assert.equal(store.schemaVersion(), 12);
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

test("R56-SEC-009 unknown route adapter or inbound state fail closed", () => {
  const store = new Store(":memory:");
  store.upsertRoute({ routeId: "r1", adapter: "mock", accountRef: "a", peerRef: "p", status: "active" });

  store.db.prepare("UPDATE routes SET adapter='unknown-adapter' WHERE route_id='r1'").run();
  assert.throws(() => store.getRoute("r1"), /UNKNOWN_ROUTE_ADAPTER/);

  store.db.prepare("UPDATE routes SET adapter='mock', status='enabled' WHERE route_id='r1'").run();
  assert.throws(() => store.getRoute("r1"), /UNKNOWN_ROUTE_STATUS/);

  store.db.prepare("UPDATE routes SET status='active' WHERE route_id='r1'").run();
  store.insertInbound(
    {
      inboundId: "in-bad",
      adapterMessageKey: "k-bad",
      routeId: "r1",
      bindingRevision: 1,
      bodyKind: "text",
      redactedDigest: "d",
      state: "queued",
    },
    "secret-body",
    1,
  );

  store.db.prepare("UPDATE inbounds SET state='success' WHERE inbound_id='in-bad'").run();
  assert.throws(() => store.getInbound("in-bad"), /UNKNOWN_INBOUND_STATE/);

  store.db.prepare("UPDATE inbounds SET state='queued', dispatch_mode='private' WHERE inbound_id='in-bad'").run();
  assert.throws(() => store.getInbound("in-bad"), /UNKNOWN_DISPATCH_MODE/);
  store.close();
});

test("startup quarantines an unsupported legacy route without deleting its audit row", () => {
  const path = tmpDb();
  let store = new Store(path);
  store.db
    .prepare("INSERT INTO routes(route_id, adapter, account_ref, peer_ref, status) VALUES (?,?,?,?,?)")
    .run("legacy-route", "retired-channel", "legacy-account", "legacy-peer", "active");
  store.db
    .prepare(
      "INSERT INTO bindings(route_id, workspace_identity, session_id, revision, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run("legacy-route", "legacy-workspace", "legacy-session", 1, "active", "2026-08-29T00:00:00.000Z", "2026-08-29T00:00:00.000Z");
  store.close();

  store = new Store(path);
  assert.deepEqual(store.listRoutes(), []);
  assert.equal(store.ownerOfSession("legacy-session"), undefined);
  const route = store.db.prepare("SELECT adapter, status FROM routes WHERE route_id=?").get("legacy-route") as {
    adapter: string;
    status: string;
  };
  const binding = store.db.prepare("SELECT status FROM bindings WHERE route_id=?").get("legacy-route") as {
    status: string;
  };
  assert.equal(route.adapter, "retired-channel");
  assert.equal(route.status, "revoked");
  assert.equal(binding.status, "revoked");
  store.close();
});

test("legacy ${channel}-default adapter config migrates transactionally", () => {
  const store = new Store(":memory:");
  store.putAdapterConfig("slack-default", "slack", JSON.stringify({ enabled: true }));
  assert.equal(store.migrateLegacyAdapterAccount("slack", "cfg:slack"), true);
  assert.equal(store.getAdapterConfig("slack-default"), undefined);
  assert.equal(JSON.parse(store.getAdapterConfig("cfg:slack") ?? "{}").enabled, true);
  assert.equal(store.migrateLegacyAdapterAccount("telegram", "cfg:telegram"), false);
  store.putAdapterConfig("qq-default", "qq", JSON.stringify({ enabled: true }));
  store.putAdapterConfig("cfg:qq", "qq", JSON.stringify({ enabled: false }));
  assert.throws(() => store.migrateLegacyAdapterAccount("qq", "cfg:qq"), /LEGACY_ACCOUNT_COLLISION/);
  assert.equal(JSON.parse(store.getAdapterConfig("qq-default") ?? "{}").enabled, true);
  store.close();
});

test("R56-SEC-012 IM body older than 24h is redacted from inbound and outbox", () => {
  const store = new Store(":memory:");
  store.upsertRoute({ routeId: "r1", adapter: "mock", accountRef: "a", peerRef: "p", status: "active" });
  const now = 2_000_000_000_000;
  store.insertInbound(
    {
      inboundId: "old",
      adapterMessageKey: "old-key",
      routeId: "r1",
      bindingRevision: 1,
      bodyKind: "text",
      redactedDigest: "d",
      state: "delivered",
    },
    "old-secret-body",
    now - 25 * 60 * 60 * 1000,
  );
  store.insertInbound(
    {
      inboundId: "fresh",
      adapterMessageKey: "fresh-key",
      routeId: "r1",
      bindingRevision: 1,
      bodyKind: "text",
      redactedDigest: "d",
      state: "queued",
    },
    "fresh-body",
    now - 60 * 1000,
  );
  store.insertOutbox({
    outboxId: "out-old",
    routeId: "r1",
    inboundId: "old",
    turnId: "t-old",
    sequence: 1,
    payloadKind: "text",
    payloadRef: "r",
    payloadText: "old-secret-reply",
    state: "delivered",
    attempts: 1,
    nextAttemptAt: now,
    fragmentIndex: 0,
    fragmentCount: 1,
  });
  const cleaned = store.redactExpiredPayloads(now);
  assert.equal(cleaned.inbounds, 1);
  assert.equal(cleaned.outbox, 1);
  assert.equal(store.getInboundPayloadText("old"), undefined);
  assert.equal(store.getInboundPayloadText("fresh"), "fresh-body");
  assert.equal(store.getOutbox("out-old")?.payloadText, "");
  store.close();
});
