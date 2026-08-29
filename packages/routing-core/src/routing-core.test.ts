import assert from "node:assert/strict";
import test from "node:test";
import { SeqIds, VirtualClock } from "@penglai/testkit";
import { Store } from "@penglai/persistence";
import type { InboundEnvelope, ModelInput } from "@penglai/contracts";
import { RoutingControlPlane, type AgentPort, type DirectoryPort } from "./index.js";

function env(over: Partial<InboundEnvelope> = {}): InboundEnvelope {
  return {
    adapter: "mock",
    adapterMessageKey: over.adapterMessageKey ?? "k1",
    accountRef: "acct",
    peerRef: "peer",
    chatKind: "private",
    bodyKind: "text",
    text: "hello",
    receivedAt: 1,
    ...over,
  };
}

function harness() {
  const clock = new VirtualClock();
  const ids = new SeqIds();
  const store = new Store(":memory:");
  const inputs: ModelInput[] = [];
  const removed: string[] = [];
  const agent: AgentPort = {
    async followup(input) {
      inputs.push(input);
      return { dshMessageId: `dsh_${input.inboundId}` };
    },
    async steer(input) {
      inputs.push(input);
      return { dshMessageId: `dsh_${input.inboundId}` };
    },
    async cancelCurrent() {},
    async removeInbox(_s, mid) {
      removed.push(mid);
    },
  };
  const directory: DirectoryPort = {
    async listWorkspaces() {
      return [{ id: "ws1", title: "Alpha" }];
    },
    async listSessions() {
      return [{ id: "sess1" }];
    },
  };
  const plane = new RoutingControlPlane(store, clock, ids, directory, agent);
  return { clock, ids, store, plane, inputs, removed };
}

test("inbound failure diagnostics persist only closed phase and reason values", () => {
  const valid = harness();
  valid.plane.recordInboundFailure(
    env({ adapterMessageKey: "media-valid", bodyKind: "media" }),
    "AUTH_EXPIRED",
    { phase: "resource-request", reason: "permission-missing" },
  );
  const validAudit = valid.store.listAudit().find((row) => row.event === "inbound_processing_failed");
  assert.equal(validAudit?.payload.phase, "resource-request");
  assert.equal(validAudit?.payload.reason, "permission-missing");

  const forged = harness();
  forged.plane.recordInboundFailure(
    env({ adapterMessageKey: "media-forged", bodyKind: "media" }),
    "DELIVERY_TRANSIENT",
    { phase: "private-phase" as never, reason: "private-detail" as never },
  );
  const forgedAudit = forged.store.listAudit().find((row) => row.event === "inbound_processing_failed");
  assert.equal("phase" in (forgedAudit?.payload ?? {}), false);
  assert.equal("reason" in (forgedAudit?.payload ?? {}), false);
  assert.doesNotMatch(JSON.stringify(forgedAudit), /private/);
});

test("R1-AUTH-001 owner private text auto-binds official default without a pairing token", async () => {
  const h = harness();
  const r = await h.plane.submitInbound(env({ text: "你好", vendorTarget: "owner" }));
  assert.equal(r.kind, "accepted");
  assert.equal(h.inputs.length, 1);
  assert.equal(h.inputs[0]?.sessionId, "sess1");
  const route = h.store.findRoute("mock", "acct", "peer");
  assert.equal(route?.status, "active");
  assert.equal(h.store.activeBinding(route!.routeId)?.sessionId, "sess1");
  const welcome = h.store.pendingOutbox(route!.routeId);
  const menu = welcome.map((item) => item.payloadText ?? "").join("\n");
  assert.match(menu, /你好，我是蓬莱/);
  assert.match(menu, /\/项目/);
  assert.doesNotMatch(menu, /DSH|DeepSeek Harness/i);
});

test("image and file inbound are accepted into the bound session", async () => {
  const h = harness();
  await h.plane.submitInbound(env({ text: "你好", vendorTarget: "owner" }));
  const officialImage = {
    attachmentId: "att-img",
    mediaType: "image/png" as const,
    bytes: 67,
    width: 1,
    height: 1,
  };
  const image = await h.plane.submitInbound(
    env({
      adapterMessageKey: "img",
      bodyKind: "media",
      text: "",
      media: {
        kind: "image",
        source: "weixin",
        sourceMessageId: "img",
        sourceResourceId: "cdn-1",
        mime: "image/png",
        size: 67,
        sha256: "a".repeat(64),
        opaqueHandle: "media-img",
        officialImage,
      },
    }),
  );
  assert.equal(image.kind, "accepted");
  assert.equal(h.inputs.at(-1)?.text.includes("penglai-media"), false);
  assert.equal(h.inputs.at(-1)?.text.includes("[image]"), false);
  assert.deepEqual(h.inputs.at(-1)?.images, [officialImage]);
  const office = await h.plane.submitInbound(
    env({
      adapterMessageKey: "doc",
      bodyKind: "media",
      text: "",
      media: {
        kind: "office",
        source: "weixin",
        sourceMessageId: "doc",
        sourceResourceId: "cdn-2",
        mime: "application/vnd.openxmlformats-officedocument",
        size: 32,
        sha256: "b".repeat(64),
        opaqueHandle: "media-doc",
        officeHandle: "obj-officehandle00000001",
      },
    }),
  );
  assert.equal(office.kind, "accepted");
  assert.equal(h.inputs.at(-1)?.officeHandle, "obj-officehandle00000001");
  assert.equal(h.inputs.at(-1)?.text.includes("penglai-media"), false);
});

test("image inbound without official DSH attachment is rejected", async () => {
  const h = harness();
  await h.plane.submitInbound(env({ text: "你好", vendorTarget: "owner" }));
  const image = await h.plane.submitInbound(
    env({
      adapterMessageKey: "img-no-att",
      bodyKind: "media",
      text: "[penglai-media kind=image mime=image/png sha256=aaaaaaaa handle=media-x]",
      media: {
        kind: "image",
        source: "weixin",
        sourceMessageId: "img-no-att",
        sourceResourceId: "cdn-1",
        mime: "image/png",
        size: 67,
        sha256: "a".repeat(64),
        opaqueHandle: "media-x",
      },
    }),
  );
  assert.equal(image.kind, "rejected");
});

test("IM project menu lists every official workspace in numbered groups", async () => {
  const clock = new VirtualClock();
  const ids = new SeqIds();
  const store = new Store(":memory:");
  const directory: DirectoryPort = {
    async listWorkspaces() {
      return [
        { id: "ws-down", title: "Downloads", sessionIds: ["s-news"] },
        { id: "ws-test", title: "api-test", sessionIds: ["s-test"] },
      ];
    },
    async listSessions(workspaceIdentity) {
      return workspaceIdentity === "ws-down"
        ? [{ id: "s-news", title: "最新AI新闻搜索" }]
        : [{ id: "s-test" }];
    },
  };
  const plane = new RoutingControlPlane(store, clock, ids, directory, {
    async followup() { return { dshMessageId: "dsh" }; },
    async steer() { return { dshMessageId: "dsh" }; },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  await plane.submitInbound(env({ text: "你好", adapterMessageKey: "hello" }));
  const listed = await plane.submitInbound(env({ text: "/项目", adapterMessageKey: "p1" }));
  assert.equal(listed.kind, "control");
  assert.match(listed.text, /【未分组】/);
  assert.match(listed.text, /1\. Downloads/);
  assert.match(listed.text, /2\. api-test/);
  assert.match(listed.text, /回复数字/);
  const picked = await plane.submitInbound(env({ text: "2", adapterMessageKey: "p2" }));
  assert.equal(picked.kind, "control");
  assert.match(picked.text, /已切换到 api-test/);
  const binding = store.listActiveBindings()[0];
  assert.equal(binding?.workspaceIdentity, "ws-test");
  assert.equal(binding?.sessionId, "s-test");
});

test("IM project menu survives restart and English slash commands stay English", async () => {
  const clock = new VirtualClock();
  const ids = new SeqIds();
  const store = new Store(":memory:");
  const directory: DirectoryPort = {
    async listWorkspaces() {
      return [
        { id: "ws-down", title: "Downloads", sessionIds: ["s-news"] },
        { id: "ws-test", title: "api-test", sessionIds: ["s-test"] },
      ];
    },
    async listSessions(workspaceIdentity) {
      return workspaceIdentity === "ws-down"
        ? [{ id: "s-news", title: "最新AI新闻搜索" }]
        : [{ id: "s-test" }];
    },
  };
  const agent = {
    async followup() { return { dshMessageId: "dsh" }; },
    async steer() { return { dshMessageId: "dsh" }; },
    async cancelCurrent() {},
    async removeInbox() {},
  };
  const first = new RoutingControlPlane(store, clock, ids, directory, agent);
  await first.submitInbound(env({ text: "你好", adapterMessageKey: "hello" }));
  const listed = await first.submitInbound(env({ text: "/项目", adapterMessageKey: "p1" }));
  assert.match(listed.text, /【未分组】/);
  const restarted = new RoutingControlPlane(store, clock, ids, directory, agent);
  const picked = await restarted.submitInbound(env({ text: "2", adapterMessageKey: "p2" }));
  assert.match(picked.text, /已切换到 api-test/);
  assert.equal(store.listActiveBindings()[0]?.workspaceIdentity, "ws-test");

  const en = await restarted.submitInbound(env({ text: "/projects", adapterMessageKey: "en1" }));
  assert.match(en.text, /\[Ungrouped\]/);
  assert.match(en.text, /Projects:/);
  assert.doesNotMatch(en.text, /【未分组】/);
});

test("R1-AUTH-010 no official workspace stays fail-closed", async () => {
  const clock = new VirtualClock();
  const ids = new SeqIds();
  const store = new Store(":memory:");
  const inputs: ModelInput[] = [];
  const plane = new RoutingControlPlane(
    store,
    clock,
    ids,
    { async listWorkspaces() { return []; }, async listSessions() { return []; } },
    {
      async followup(input) {
        inputs.push(input);
        return { dshMessageId: `dsh_${input.inboundId}` };
      },
      async steer(input) {
        inputs.push(input);
        return { dshMessageId: `dsh_${input.inboundId}` };
      },
      async cancelCurrent() {},
      async removeInbox() {},
    },
  );
  const r = await plane.submitInbound(env({ text: "你好" }));
  assert.equal(r.kind, "rejected");
  assert.match(r.text, /official workspace/i);
  assert.equal(inputs.length, 0);
  const projects = await plane.submitInbound(env({ text: "/项目", adapterMessageKey: "c1" }));
  assert.equal(projects.errorClass, "UNAUTHORIZED");
});

test("R1-AUTH-002 bind token then followup", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  const b = await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  assert.equal(b.kind, "control");
  const r = await h.plane.submitInbound(env({ text: "do work", adapterMessageKey: "m1" }));
  assert.equal(r.kind, "accepted");
  assert.equal(h.inputs.length, 1);
  assert.equal(h.inputs[0]?.source.kind, "user");
});

test("IM /模型 lists and switches through the official session model directory", async () => {
  const h = harness();
  let selected = { provider: "deepseek", model: "deepseek-chat" };
  Object.assign((h.plane as unknown as { directory: DirectoryPort }).directory, {
    async describeSessionModels() {
      return {
        current: selected,
        routable: true,
        groups: [{
          id: "deepseek",
          name: "DeepSeek",
          models: [
            { id: "deepseek-chat", name: "DeepSeek Chat" },
            { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
          ],
        }],
      };
    },
    async selectSessionModel(_sessionId: string, next: { provider: string; model: string }) {
      selected = next;
      return next;
    },
  });
  await h.plane.submitInbound(env({ text: "你好", adapterMessageKey: "model-bind" }));
  const listed = await h.plane.submitInbound(env({ text: "/模型", adapterMessageKey: "model-list" }));
  assert.equal(listed.kind, "control");
  assert.match(listed.text, /当前：deepseek\/deepseek-chat/);
  assert.match(listed.text, /2\. deepseek\/deepseek-reasoner/);
  const switched = await h.plane.submitInbound(env({ text: "/模型 2", adapterMessageKey: "model-switch" }));
  assert.equal(switched.kind, "control");
  assert.match(switched.text, /deepseek\/deepseek-reasoner/);
  assert.deepEqual(selected, { provider: "deepseek", model: "deepseek-reasoner" });
  assert.equal(h.inputs.length, 1, "model commands stay out of the model context");
});

test("R1-AUTH-003 expired token", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  h.clock.advance(6 * 60_000);
  const r = await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  assert.equal(r.errorClass, "UNAUTHORIZED");
});

test("R1-AUTH-004 token replay", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  const r = await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b2", peerRef: "other" }));
  assert.match(r.text, /reused|invalid|owner/i);
});

test("R1-STATE-001 duplicate inbound only one model input", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  await h.plane.submitInbound(env({ text: "x", adapterMessageKey: "dup" }));
  await h.plane.submitInbound(env({ text: "x", adapterMessageKey: "dup" }));
  assert.equal(h.inputs.length, 1);
});

test("R1-ROUTE-002 desktop turn never outbox", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  h.plane.noteDesktopTurn("sess1", "turn-desk");
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "turn-desk", text: "secret desktop" });
  assert.equal(h.store.pendingOutbox(h.store.findRoute("mock", "acct", "peer")!.routeId).length, 0);
});

test("R1-ROUTE-001 claimed then final goes to same route", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  await h.plane.submitInbound(env({ text: "task", adapterMessageKey: "m1" }));
  const inboundId = h.inputs[0]!.inboundId;
  const routeId = h.inputs[0]!.routeId;
  h.plane.onClaimed({
    dshMessageId: `dsh_${inboundId}`,
    turnId: "7",
    sessionId: "sess1",
    source: { kind: "penglai-im", schema: 1, routeId, inboundId, adapter: "mock" },
  });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "7", text: "answer" });
  const box = h.store.pendingOutbox(routeId);
  assert.equal(box.length, 1);
  assert.equal(box[0]?.payloadText, "answer");
});

test("R1-ROUTE-005 forged source does not correlate", async () => {
  const h = harness();
  h.plane.onClaimed({
    dshMessageId: "x",
    turnId: "1",
    sessionId: "sess1",
    source: { kind: "user" },
  });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "1", text: "nope" });
  const n = h.store.db.prepare("SELECT COUNT(*) AS c FROM outbox").get() as { c: number };
  assert.equal(Number(n.c), 0);
});

test("group rejected and media accepted", async () => {
  const h = harness();
  const g = await h.plane.submitInbound(env({ chatKind: "group", adapterMessageKey: "g" }));
  const m = await h.plane.submitInbound(
    env({
      bodyKind: "media",
      adapterMessageKey: "m",
      text: "",
      media: {
        kind: "file",
        source: "feishu",
        sourceMessageId: "m",
        sourceResourceId: "file-1",
        mime: "application/octet-stream",
        size: 4,
        sha256: "b".repeat(64),
        opaqueHandle: "media-file",
      },
    }),
  );
  assert.equal(g.kind, "rejected");
  assert.equal(m.kind, "accepted");
});

test("context/memory/budget/companion/voice slash commands never enter the model", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b-cmd" }));
  for (const [key, cmd] of [
    ["c1", "/资料"],
    ["c2", "/记忆"],
    ["c3", "/预算"],
    ["c4", "/陪伴"],
    ["c5", "/语音 跟随"],
    ["c6", "/声音 moss-zh-default"],
    ["c7", "/语音 状态"],
  ] as const) {
    const r = await h.plane.submitInbound(env({ text: cmd, adapterMessageKey: key }));
    assert.equal(r.kind, "control");
  }
  assert.equal(h.inputs.length, 0);
});

test("R50-VOICE-014/015 durable voice claim reaches one exact Turn and mirror policy follows input", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "weixin" });
  const bind = await h.plane.submitInbound(env({
    adapter: "weixin",
    peerRef: "peer-wx",
    vendorTarget: "wx-owner",
    text: `/绑定 ${token}`,
    adapterMessageKey: "bind-wx",
  }));
  assert.equal(bind.kind, "control");
  const voiceEnv = env({
    adapter: "weixin",
    peerRef: "peer-wx",
    vendorTarget: "wx-owner",
    bodyKind: "voice",
    text: "",
    adapterMessageKey: "voice-1",
  });
  const mediaRefJson = JSON.stringify({ kind: "silk", ref: "opaque-1" });
  const claimed = await h.plane.claimVoiceInbound(voiceEnv, { mediaRefJson, durationMs: 1_000, expectedBytes: 512 });
  assert.equal(claimed.kind, "voice_claim");
  if (claimed.kind !== "voice_claim") return;
  assert.equal(claimed.duplicate, false);
  const duplicate = await h.plane.claimVoiceInbound(voiceEnv, { mediaRefJson, durationMs: 1_000, expectedBytes: 512 });
  assert.equal(duplicate.kind, "voice_claim");
  if (duplicate.kind === "voice_claim") assert.equal(duplicate.duplicate, true);
  h.plane.markVoiceProcessing(claimed);
  const completed = await h.plane.completeVoiceInbound(
    claimed,
    { text: "语音转写", language: "zh", emotion: "HAPPY" },
    "a".repeat(64),
  );
  assert.equal(completed.kind, "accepted");
  assert.equal(h.inputs.length, 1);
  assert.equal(h.inputs[0]?.text, "语音转写");
  assert.deepEqual(h.inputs[0]?.source.voice, { language: "zh", emotion: "HAPPY", durationMs: 1_000 });
  h.plane.onClaimed({
    dshMessageId: `dsh_${claimed.inboundId}`,
    turnId: "voice-turn-1",
    sessionId: "sess1",
    source: h.inputs[0]!.source,
  });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "voice-turn-1", text: "最终回答" });
  const outbox = h.store.outboxForInbound(claimed.inboundId);
  assert.equal(outbox.length, 1);
  const delivery = h.plane.resolveVoiceDelivery(outbox[0]!.outboxId);
  assert.equal(delivery.mode, "voice");
  assert.equal(delivery.finalText, "最终回答");
  assert.equal(delivery.failureFallback, "text");
  assert.match(delivery.operationId, /^tts_[a-f0-9]{32}$/);
});

test("voice replay with changed media reference and stale binding fail closed", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "feishu" });
  await h.plane.submitInbound(env({
    adapter: "feishu",
    peerRef: "peer-fs",
    vendorTarget: "ou-owner",
    text: `/绑定 ${token}`,
    adapterMessageKey: "bind-fs",
  }));
  const voiceEnv = env({
    adapter: "feishu",
    peerRef: "peer-fs",
    vendorTarget: "ou-owner",
    bodyKind: "voice",
    text: "",
    adapterMessageKey: "audio-1",
  });
  const claim = await h.plane.claimVoiceInbound(voiceEnv, {
    mediaRefJson: JSON.stringify({ messageId: "audio-1", fileKey: "file-a" }),
    durationMs: 900,
  });
  assert.equal(claim.kind, "voice_claim");
  const mismatch = await h.plane.claimVoiceInbound(voiceEnv, {
    mediaRefJson: JSON.stringify({ messageId: "audio-1", fileKey: "file-b" }),
    durationMs: 900,
  });
  assert.equal(mismatch.errorClass, "SECURITY_POLICY");
  if (claim.kind !== "voice_claim") return;
  h.plane.rebind(claim.routeId, "ws1", "sess2");
  const stale = await h.plane.completeVoiceInbound(claim, { text: "stale" }, "b".repeat(64));
  assert.equal(stale.errorClass, "BINDING_STALE");
  assert.equal(h.inputs.length, 0);
});

test("private voice without transcript is rejected; transcribed voice can enter Turn", async () => {
  const h = harness();
  const bare = await h.plane.submitInbound(env({ bodyKind: "voice", text: "", adapterMessageKey: "v0" }));
  assert.equal(bare.kind, "rejected");
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b-voice" }));
  const ok = await h.plane.submitInbound(env({ bodyKind: "voice", text: "transcribed", adapterMessageKey: "v1" }));
  assert.equal(ok.kind, "accepted");
});

test("R1-STATE-008 stop reports remaining queue", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  await h.plane.submitInbound(env({ text: "one", adapterMessageKey: "m1" }));
  await h.plane.submitInbound(env({ text: "two", adapterMessageKey: "m2" }));
  const r = await h.plane.submitInbound(env({ text: "/停止当前", adapterMessageKey: "s" }));
  assert.match(r.text, /queued remaining=2/);
});

test("R1-STATE-009 clear only unclaimed", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  await h.plane.submitInbound(env({ text: "one", adapterMessageKey: "m1" }));
  const r = await h.plane.submitInbound(env({ text: "/清空本聊天队列", adapterMessageKey: "c" }));
  assert.match(r.text, /cleared 1/);
  assert.equal(h.removed.length, 1);
});

test("R1-ROUTE-009 rebind invalidates queued revision", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  await h.plane.submitInbound(env({ text: "old", adapterMessageKey: "m1" }));
  const inboundId = h.inputs[0]!.inboundId;
  const routeId = h.inputs[0]!.routeId;
  h.plane.rebind(routeId, "ws1", "sess2");
  h.plane.onClaimed({
    dshMessageId: `dsh_${inboundId}`,
    turnId: "3",
    sessionId: "sess1",
    source: { kind: "penglai-im", schema: 1, routeId, inboundId, adapter: "mock" },
  });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "3", text: "should not send" });
  assert.equal(h.store.pendingOutbox(routeId).length, 0);
});

test("R1-STATE-013 restart does not resend delivered", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  await h.plane.submitInbound(env({ text: "task", adapterMessageKey: "m1" }));
  const inboundId = h.inputs[0]!.inboundId;
  const routeId = h.inputs[0]!.routeId;
  h.plane.onClaimed({
    dshMessageId: `dsh_${inboundId}`,
    turnId: "8",
    sessionId: "sess1",
    source: { kind: "penglai-im", schema: 1, routeId, inboundId, adapter: "mock" },
  });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "8", text: "ok" });
  const item = h.store.pendingOutbox(routeId)[0]!;
  const claim = h.plane.markSending(item.outboxId, "test-worker");
  h.plane.markDelivered(item.outboxId, claim);
  assert.equal(h.plane.dueOutbox(routeId).length, 0);
});

test("outbox revalidates exact binding and target immediately before transport", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({
    text: `/绑定 ${token}`,
    adapterMessageKey: "bind-delivery",
    vendorTarget: "vendor-original",
  }));
  await h.plane.submitInbound(env({ text: "task", adapterMessageKey: "work-delivery" }));
  const input = h.inputs[0]!;
  h.plane.onClaimed({
    dshMessageId: `dsh_${input.inboundId}`,
    turnId: "delivery-turn",
    sessionId: "sess1",
    source: input.source,
  });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "delivery-turn", text: "private answer" });
  const item = h.store.outboxForInbound(input.inboundId)[0]!;
  h.plane.rebind(input.routeId, "ws1", "sess2");
  h.plane.markSending(item.outboxId);
  assert.throws(() => h.plane.resolveVoiceDelivery(item.outboxId), /binding_stale/);
  assert.equal(h.store.getOutbox(item.outboxId)?.state, "dead");
  assert.equal(h.store.getInbound(input.inboundId)?.state, "no_delivery");
});

test("weixin and feishu owner DMs share the official default session", async () => {
  const h = harness();
  const wx = await h.plane.submitInbound(env({
    adapter: "weixin",
    peerRef: "wx-owner",
    vendorTarget: "wx-owner",
    text: "你好",
    adapterMessageKey: "wx-hi",
  }));
  const fs = await h.plane.submitInbound(env({
    adapter: "feishu",
    peerRef: "fs-owner",
    vendorTarget: "ou-owner",
    text: "你好",
    adapterMessageKey: "fs-hi",
  }));
  assert.equal(wx.kind, "accepted");
  assert.equal(fs.kind, "accepted");
  assert.equal(h.inputs.length, 2);
  assert.equal(h.inputs[0]?.sessionId, "sess1");
  assert.equal(h.inputs[1]?.sessionId, "sess1");
  assert.notEqual(h.inputs[0]?.routeId, h.inputs[1]?.routeId);
});

test("help after scan auto-binds and can be delivered without a pairing token", async () => {
  const h = harness();
  const r = await h.plane.submitInbound(env({ text: "/帮助", adapterMessageKey: "help-1", vendorTarget: "owner" }));
  assert.equal(r.kind, "control");
  assert.match(r.text, /\/项目/);
  assert.match(r.text, /\/帮助/);
  const route = h.store.findRoute("mock", "acct", "peer")!;
  assert.equal(route.status, "active");
  const out = h.store.pendingOutbox(route.routeId);
  assert.equal(out.length, 1);
  assert.doesNotThrow(() => h.plane.resolveVoiceDelivery(out[0]!.outboxId));
});

test("first owner voice auto-binds official default", async () => {
  const h = harness();
  const claimed = await h.plane.claimVoiceInbound(env({
    adapter: "weixin",
    peerRef: "peer-wx",
    vendorTarget: "wx-owner",
    bodyKind: "voice",
    text: "",
    adapterMessageKey: "voice-auto",
  }), { mediaRefJson: JSON.stringify({ kind: "silk", ref: "opaque-auto" }), durationMs: 1_000 });
  assert.equal(claimed.kind, "voice_claim");
});

test("R1-AUTH-007 second route cannot silent-own session", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  const { token: t2 } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  const r = await h.plane.submitInbound(env({ text: `/绑定 ${t2}`, adapterMessageKey: "b2", peerRef: "peer2" }));
  assert.equal(r.errorClass, "SECURITY_POLICY");
});

test("R1-AUTH-005 wrong adapter token rejected", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "weixin" });
  const r = await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  assert.equal(r.errorClass, "UNAUTHORIZED");
});

test("R1-AUTH-008/009 explicit rebind then unbind", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  const routeId = h.store.findRoute("mock", "acct", "peer")!.routeId;
  const rebound = h.plane.rebind(routeId, "ws1", "sess2");
  assert.match(rebound.text, /rev=2/);
  const u = await h.plane.submitInbound(env({ text: "/解绑", adapterMessageKey: "u1" }));
  assert.equal(u.kind, "control");
  const later = await h.plane.submitInbound(env({ text: "after unbind", adapterMessageKey: "m9", vendorTarget: "owner" }));
  assert.equal(later.kind, "accepted");
  assert.equal(h.inputs.length, 1);
});

test("R1-ROUTE-003 two routes two sessions isolated", async () => {
  const h = harness();
  const { token: t1 } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  const { token: t2 } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess2", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${t1}`, adapterMessageKey: "b1", peerRef: "p1" }));
  await h.plane.submitInbound(env({ text: `/绑定 ${t2}`, adapterMessageKey: "b2", peerRef: "p2" }));
  await h.plane.submitInbound(env({ text: "alpha", adapterMessageKey: "m1", peerRef: "p1" }));
  await h.plane.submitInbound(env({ text: "beta", adapterMessageKey: "m2", peerRef: "p2" }));
  const a = h.inputs[0]!;
  const b = h.inputs[1]!;
  h.plane.onClaimed({
    dshMessageId: `dsh_${a.inboundId}`,
    turnId: "1",
    sessionId: "sess1",
    source: { kind: "penglai-im", schema: 1, routeId: a.routeId, inboundId: a.inboundId, adapter: "mock" },
  });
  h.plane.onClaimed({
    dshMessageId: `dsh_${b.inboundId}`,
    turnId: "1",
    sessionId: "sess2",
    source: { kind: "penglai-im", schema: 1, routeId: b.routeId, inboundId: b.inboundId, adapter: "mock" },
  });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "1", text: "out-a" });
  h.plane.onAssistantFinal({ sessionId: "sess2", turnId: "1", text: "out-b" });
  assert.equal(h.store.pendingOutbox(a.routeId)[0]?.payloadText, "out-a");
  assert.equal(h.store.pendingOutbox(b.routeId)[0]?.payloadText, "out-b");
});

test("R1-ROUTE-006/007 unknown claimed and wrong turn never outbox", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  h.plane.onClaimed({
    dshMessageId: "ghost",
    turnId: "99",
    sessionId: "sess1",
    source: { kind: "penglai-im", schema: 1, routeId: "nope", inboundId: "missing", adapter: "mock" },
  });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "99", text: "leak" });
  const n = h.store.db.prepare("SELECT COUNT(*) AS c FROM outbox").get() as { c: number };
  assert.equal(Number(n.c), 0);
});

test("R1-ROUTE-008/011 session-level and empty output stay local", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  await h.plane.submitInbound(env({ text: "task", adapterMessageKey: "m1" }));
  const inboundId = h.inputs[0]!.inboundId;
  const routeId = h.inputs[0]!.routeId;
  h.plane.onClaimed({
    dshMessageId: `dsh_${inboundId}`,
    turnId: "2",
    sessionId: "sess1",
    source: { kind: "penglai-im", schema: 1, routeId, inboundId, adapter: "mock" },
  });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "2", text: "   " });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "other", text: "desktop-ish" });
  assert.equal(h.store.pendingOutbox(routeId).length, 0);
});

test("R1-ROUTE-010 claimed then rebind does not retarget", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  await h.plane.submitInbound(env({ text: "old", adapterMessageKey: "m1" }));
  const inboundId = h.inputs[0]!.inboundId;
  const routeId = h.inputs[0]!.routeId;
  h.plane.onClaimed({
    dshMessageId: `dsh_${inboundId}`,
    turnId: "4",
    sessionId: "sess1",
    source: { kind: "penglai-im", schema: 1, routeId, inboundId, adapter: "mock" },
  });
  h.plane.rebind(routeId, "ws1", "sess2");
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "4", text: "stale" });
  assert.equal(h.store.pendingOutbox(routeId).length, 0);
});

test("R1-ROUTE-012 long text fragments keep order", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  await h.plane.submitInbound(env({ text: "task", adapterMessageKey: "m1" }));
  const inboundId = h.inputs[0]!.inboundId;
  const routeId = h.inputs[0]!.routeId;
  h.plane.onClaimed({
    dshMessageId: `dsh_${inboundId}`,
    turnId: "5",
    sessionId: "sess1",
    source: { kind: "penglai-im", schema: 1, routeId, inboundId, adapter: "mock" },
  });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "5", text: "x".repeat(4000) });
  const box = h.store.pendingOutbox(routeId);
  assert.equal(box.length, 3);
  assert.equal(box[0]?.fragmentIndex, 0);
  assert.equal(box[2]?.fragmentIndex, 2);
  assert.equal(box[0]?.sequence! < box[1]?.sequence!, true);
});

test("R1-STATE-003/004 duplicate final and ack are idempotent", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  await h.plane.submitInbound(env({ text: "task", adapterMessageKey: "m1" }));
  const inboundId = h.inputs[0]!.inboundId;
  const routeId = h.inputs[0]!.routeId;
  h.plane.onClaimed({
    dshMessageId: `dsh_${inboundId}`,
    turnId: "6",
    sessionId: "sess1",
    source: { kind: "penglai-im", schema: 1, routeId, inboundId, adapter: "mock" },
  });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "6", text: "once" });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "6", text: "once" });
  const n = h.store.db.prepare("SELECT COUNT(*) AS c FROM outbox").get() as { c: number };
  assert.equal(Number(n.c), 1);
  const item = h.store.pendingOutbox(routeId)[0]!;
  const claim = h.plane.markSending(item.outboxId, "test-worker");
  h.plane.markDelivered(item.outboxId, claim);
  h.plane.markDelivered(item.outboxId, claim);
  assert.equal(h.store.getOutbox(item.outboxId)?.state, "delivered");
});

test("R1-STATE-005 FIFO three messages keep input order", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  await h.plane.submitInbound(env({ text: "one", adapterMessageKey: "m1" }));
  await h.plane.submitInbound(env({ text: "two", adapterMessageKey: "m2" }));
  await h.plane.submitInbound(env({ text: "three", adapterMessageKey: "m3" }));
  assert.deepEqual(h.inputs.map((i) => i.text), ["one", "two", "three"]);
});

test("R1-STATE-007 steer does not use followup", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  const r = await h.plane.submitInbound(env({ text: "/插话 hurry", adapterMessageKey: "s1" }));
  assert.equal(r.kind, "control");
  assert.equal(h.inputs[0]?.mode, "steer");
});

test("R1-STATE-011/012 sending crash recovers without new id", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  await h.plane.submitInbound(env({ text: "task", adapterMessageKey: "m1" }));
  const inboundId = h.inputs[0]!.inboundId;
  const routeId = h.inputs[0]!.routeId;
  h.plane.onClaimed({
    dshMessageId: `dsh_${inboundId}`,
    turnId: "10",
    sessionId: "sess1",
    source: { kind: "penglai-im", schema: 1, routeId, inboundId, adapter: "mock" },
  });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "10", text: "payload" });
  const item = h.store.pendingOutbox(routeId)[0]!;
  h.plane.markSending(item.outboxId);
  const recovered = h.plane.recoverAfterCrash();
  assert.equal(recovered.sendingRecovered, 1);
  const again = h.plane.dueOutbox(routeId);
  assert.equal(again.length, 1);
  assert.equal(again[0]?.outboxId, item.outboxId);
});

test("R50-ROUTE-003/010 slash commands never enter followup and audit has no body", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  await h.plane.submitInbound(env({ text: "/状态", adapterMessageKey: "st" }));
  await h.plane.submitInbound(env({ text: "/帮助", adapterMessageKey: "hp" }));
  assert.equal(h.inputs.length, 0);
  const audits = h.store.listAudit();
  assert.equal(JSON.stringify(audits).includes("绑定"), false);
  assert.equal(JSON.stringify(audits).includes(token), false);
});

test("R50-ROUTE-009 missing vendor reply target fail-closes and never sends", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  const accepted = await h.plane.submitInbound(env({ text: "hello model", adapterMessageKey: "m1" }));
  assert.equal(accepted.kind, "accepted");
  const inbound = h.store.queuedForRoute(h.store.listRoutes()[0]!.routeId)[0]!;
  h.plane.onClaimed({
    dshMessageId: `dsh_${inbound.inboundId}`,
    turnId: "t1",
    sessionId: "sess1",
    source: { kind: "penglai-im", schema: 1, routeId: inbound.routeId, inboundId: inbound.inboundId, adapter: "mock" },
  });
  h.plane.onAssistantFinal({ sessionId: "sess1", turnId: "t1", text: "final-text" });
  const routeId = inbound.routeId;
  assert.equal(h.store.getVendorReplyTarget(routeId), undefined);
  const closed = h.plane.failClosedMissingTarget(routeId);
  assert.ok(closed >= 1);
  assert.equal(h.plane.dueOutbox(routeId).length, 0);
  assert.throws(() => h.plane.requireVendorTarget(routeId), /vendor reply target/);
});

test("R1-STATE-007 slash commands never enter followup text", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws1", sessionId: "sess1", adapter: "mock" });
  await h.plane.submitInbound(env({ text: `/绑定 ${token}`, adapterMessageKey: "b1" }));
  await h.plane.submitInbound(env({ text: "/状态", adapterMessageKey: "st" }));
  await h.plane.submitInbound(env({ text: "/帮助", adapterMessageKey: "hp" }));
  assert.equal(h.inputs.length, 0);
});
test("companion output uses a durable control claim, dedupes, and cancels without a forged user input", async () => {
  const h = harness();
  const { token } = h.plane.createPairing({
    workspaceIdentity: "ws1",
    sessionId: "sess1",
    adapter: "mock",
  });
  await h.plane.submitInbound(
    env({
      text: `/绑定 ${token}`,
      adapterMessageKey: "b1",
      vendorTarget: "opaque-vendor-reply-target",
    }),
  );
  const route = h.store.findRoute("mock", "acct", "peer")!;
  const binding = h.store.activeBinding(route.routeId)!;
  const triggerId = `comp_${"a".repeat(64)}`;

  const first = h.plane.enqueueProactive({
    routeId: route.routeId,
    expectedBindingRevision: binding.revision,
    sourceSessionId: "companion-session",
    triggerId,
    turnId: "turn-1",
    text: "durable proactive output",
    deliveryMode: "voice",
  });
  assert.equal(first.duplicate, false);
  assert.equal(h.inputs.length, 0);
  assert.equal(h.store.getInbound(first.inboundId)?.bodyKind, "control");
  assert.equal(h.store.latestUserInboundAt(route.routeId), undefined);
  const companionPending = () =>
    h.store.pendingOutbox(route.routeId).filter((o) => o.inboundId === first.inboundId);
  assert.equal(companionPending().length, 1);
  assert.equal(companionPending()[0]?.payloadText, "durable proactive output");
  assert.equal(h.plane.resolveVoiceDelivery(first.outboxIds[0]!).mode, "voice");

  const replay = h.plane.enqueueProactive({
    routeId: route.routeId,
    expectedBindingRevision: binding.revision,
    sourceSessionId: "companion-session",
    triggerId,
    turnId: "turn-1",
    text: "must not enqueue twice",
    deliveryMode: "voice",
  });
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.outboxIds, first.outboxIds);
  assert.equal(companionPending().length, 1);

  assert.equal(h.plane.cancelProactive(route.routeId, [triggerId]), 1);
  assert.equal(companionPending().length, 0);
  assert.equal(h.store.getInbound(first.inboundId)?.state, "no_delivery");
  assert.throws(
    () =>
      h.plane.enqueueProactive({
        routeId: route.routeId,
        expectedBindingRevision: binding.revision + 1,
        sourceSessionId: "companion-session",
        triggerId: `comp_${"b".repeat(64)}`,
        turnId: "turn-2",
        text: "stale binding",
        deliveryMode: "text-and-voice",
      }),
    /binding/i,
  );
});
