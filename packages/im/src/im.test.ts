import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
import { PenglaiError } from "@penglai/contracts";
import {
  addVoiceContextAtOfficialPreStep,
  apply,
  createRuntime,
  inject,
  optionalVoiceServicesFrom,
  PenglaiImRemote,
} from "./index.js";
import { CredentialsServiceVault } from "./credentials-vault.js";
import { PenglaiImHost } from "./host.js";
import { contribute } from "./client.js";

async function runTestOnlyCausalRoute(
  host: PenglaiImHost,
  input: { workspaceId: string; sessionId: string },
): Promise<{ causalRoute: true; inboundId: string; turnId: string; routeId: string; reply: string }> {
  const binding = host.createBinding({
    channel: "weixin",
    accountId: "test-profile",
    peerId: "test-peer",
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
  });
  const accepted = await host.plane.submitInbound({
    adapter: "weixin",
    adapterMessageKey: `causal-${Date.now()}`,
    accountRef: "test-profile",
    peerRef: "test-peer",
    chatKind: "private",
    bodyKind: "text",
    text: "reply with the exact token penglai-causal-ok",
    receivedAt: Date.now(),
  });
  if (accepted.kind !== "accepted") {
    throw new PenglaiError("DSH_UNAVAILABLE", `causal inbound rejected: ${accepted.text}`);
  }
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const outbox = host.store.pendingOutbox(binding.id);
    const reply = outbox.map((item) => item.payloadText).join("");
    const inboundId = outbox[0]?.inboundId;
    const turnId = outbox[0]?.turnId;
    if (inboundId && turnId && reply.includes("penglai-causal-ok")) {
      return { causalRoute: true, inboundId, turnId, routeId: binding.id, reply };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new PenglaiError("DSH_UNAVAILABLE", "causal Message→Turn→route did not complete");
}

test("im runtime wires single control plane", async () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: {
      version: "0.1.1-rc.2",
      getAgent: () => undefined,
      listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
    },
  });
  const { token } = rt.plane.createPairing({ workspaceIdentity: "w", sessionId: "s", adapter: "mock" });
  assert.ok(token.length >= 32);
  rt.store.close();
});

test("IM requires DSH core services including official attachments; ASR and TTS stay optional", () => {
  assert.deepEqual(inject, ["agents", "workspaceRegistry", "credentials", "apiProxy", "attachments"]);
});

test("optional voice capabilities resolve dynamically across hot plug and unload", () => {
  const services = new Map<string, unknown>();
  const voice = optionalVoiceServicesFrom({
    on() {},
    get(name: string) {
      return services.get(name);
    },
  } as never);
  assert.equal(voice.asr, undefined);
  assert.equal(voice.tts, undefined);
  const asr = { stageAudio: async () => undefined, transcribe: async () => undefined } as never;
  const tts = { synthesize: async () => undefined, readOutput: async () => undefined, releaseOutput: async () => undefined } as never;
  services.set("penglaiAsr", asr);
  assert.equal(voice.asr, asr);
  assert.equal(voice.tts, undefined);
  services.set("penglaiMossTts", tts);
  assert.equal(voice.tts, tts);
  services.delete("penglaiAsr");
  assert.equal(voice.asr, undefined);
  assert.equal(voice.tts, tts);
});

test("IM composes local ASR metadata through the official DSH pre-step", async () => {
  const durable = {
    id: "voice-1",
    role: "user",
    content: [{ type: "text", text: "原始转写" }],
    source: {
      kind: "penglai-im",
      schema: 1,
      routeId: "route-1",
      inboundId: "voice-1",
      adapter: "feishu",
      voice: { language: "zh", emotion: "SAD" },
    },
  };
  const decision = await addVoiceContextAtOfficialPreStep(async () => ({ kind: "enter", messages: [durable] }));
  assert.equal((decision as any).kind, "enter");
  assert.match((decision as any).messages[0].content[0].text, /language=zh; emotion=SAD/);
  assert.equal((decision as any).messages[0].content[1].text, "原始转写");
  assert.equal(durable.content.length, 1);
});

test("pure IM starts without ASR/TTS and has no ad-hoc HTTP", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-im-apply-"));
  process.env.PENGLAI_USER_DATA = root;
  delete process.env.PENGLAI_IM_START_WORKERS;
  const held: { name?: string; host?: { getOverview: () => Promise<{ plugin: string }> } } = {};
  const listeners = new Map<string, { listener: (...args: unknown[]) => unknown; options?: Record<string, unknown> }>();
  const ctx = {
    on(event: string, listener: (...args: unknown[]) => unknown, options?: Record<string, unknown>) {
      listeners.set(event, { listener, ...(options ? { options } : {}) });
    },
    provide(name: string, value: unknown) {
      held.name = name;
      held.host = value as { getOverview: () => Promise<{ plugin: string }> };
    },
  };
  const rt = apply(ctx);
  assert.ok(held.host);
  assert.equal(held.name, "penglaiImCore");
  assert.equal(rt.supervisor.running, true);
  assert.deepEqual(listeners.get("agent/pre-step")?.options, { global: true, prepend: true });
  const plainDecision = await listeners.get("agent/pre-step")?.listener(
    {},
    async () => ({ kind: "enter", messages: [{ content: [{ type: "text", text: "plain IM" }], source: { kind: "user" } }] }),
  );
  assert.equal((plainDecision as any).messages[0].content[0].text, "plain IM");
  rt.supervisor.stop();
  rt.store.close();
});

test("R50-ROUTE-001/002/009 binding is official live list plus CAS and vendor target", () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: {
      version: "0.1.1-rc.2",
      getAgent: () => undefined,
      listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s1"] }],
    },
  });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    {
      health: () => ({ authState: "idle", hasCredential: false }),
      pumpOutbox: async () => undefined,
      nativeVoiceCapability: () => ({ enabled: false }),
    } as never,
    { status: "idle", setupRequired: true, pumpOutbox: async () => undefined } as never,
    new CredentialsServiceVault(undefined),
    { running: false, start: async () => undefined, stop: () => undefined } as never,
    {
      version: "0.1.1-rc.2",
      getAgent: () => undefined,
      listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s1"] }],
    },
  );
  const listed = host.listWorkspacesAndSessions();
  assert.deepEqual(listed.workspaces[0]?.sessions, ["s1"]);
  assert.throws(
    () =>
      host.createBinding({
        channel: "weixin",
        accountId: "a",
        peerId: "p",
        workspaceId: "w",
        sessionId: "s1",
        expectedRevision: 99,
      }),
    /revision mismatch|BINDING_STALE/,
  );
  const binding = host.createBinding({
    channel: "weixin",
    accountId: "a",
    peerId: "p",
    workspaceId: "w",
    sessionId: "s1",
    expectedRevision: host.revision,
  });
  assert.equal(binding.workspaceId, "w");
  const voice = host.updateBindingVoicePolicy({
    id: binding.id,
    expectedRevision: binding.revision,
    inputMode: "text-and-voice",
    replyMode: "text-and-voice",
    voiceId: "moss-zh-default",
  });
  assert.equal(voice.voice.replyMode, "text-and-voice");
  assert.equal(host.listBindings()[0]?.voice.replyMode, "text-and-voice");
  assert.deepEqual(host.getVoiceOptions().weixinNative, { enabled: false });
  assert.equal(rt.store.getVendorReplyTarget(binding.id), undefined);
  assert.throws(() => rt.plane.requireVendorTarget(binding.id), /vendor reply target/);
  rt.store.close();
});

test("R50-IM-001 weixin and feishu share the single @penglai/im host", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /WeixinAdapter/);
  assert.match(src, /FeishuAdapter/);
  assert.match(src, /PenglaiImHost/);
  assert.equal(src.includes("beginDeviceFlow"), false);
});

test("R50-FS-002 Feishu App ID persists and secret stays a credential ref", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-im-feishu-"));
  process.env.PENGLAI_USER_DATA = root;
  const rt = createRuntime({
    dbPath: ":memory:",
    host: {
      version: "0.1.1-rc.2",
      getAgent: () => undefined,
      listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
    },
  });
  const vault = new CredentialsServiceVault({
    async set() {},
    async describe() {
      return { configured: true, source: "local", writable: true };
    },
    async resolve() {
      return { configured: true, source: "local" };
    },
    async unset() {},
  } as never);
  const weixin = {
    health: () => ({ authState: "idle" as const, hasCredential: false }),
    startQr: async () => ({ qrRef: "q" }),
    poll: async () => "waiting" as const,
    logout: async () => undefined,
    startReceive: async () => undefined,
    stopReceive: () => undefined,
    pumpOutbox: async () => undefined,
  };
  const feishu = {
    status: "idle",
    setupRequired: true,
    connect: async () => undefined,
  };
  const supervisor = { running: false, start: async () => undefined, stop: () => undefined };
  const host = new PenglaiImHost(rt.store, rt.plane, weixin as never, feishu as never, vault, supervisor as never, {
    version: "0.1.1-rc.2",
    getAgent: () => undefined,
    listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
  });
  const configured = await host.configureFeishu({ appId: "cli_probe", secret: "not-a-real-secret" });
  assert.equal(configured.configured, true);
  const overview = await host.getOverview();
  assert.equal(overview.feishuAppId, "cli_probe");
  assert.equal(JSON.stringify(overview).includes("not-a-real-secret"), false);
  rt.store.close();
});

test("production IM does not depend on @penglai/testkit", () => {
  const pack = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(pack.dependencies?.["@penglai/testkit"], undefined);
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /@penglai\/testkit/);
  assert.match(src, /from "\.\/runtime-ids\.js"/);
});

test("R50-ROUTE-001 IM client bindings pane uses official workspace/session list", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(client, /listWorkspacesAndSessions/);
  assert.match(client, /createBinding/);
  assert.match(client, /data-penglai-im-binding/);
  assert.match(client, /首次消息会收到欢迎和 \/帮助 \/项目 菜单/);
  assert.equal(client.includes("已连接不等于已绑定"), false);
  assert.match(client, /data-penglai-im-voice-policy/);
  assert.match(client, /updateBindingVoicePolicy/);
  assert.match(client, /data-penglai-weixin-native-voice/);
  assert.match(client, /probeWeixinText/);
  assert.match(client, /发送微信文字测试/);
  assert.match(client, /probeWeixinNativeVoice/);
  assert.match(client, /confirmWeixinNativeVoice/);
  assert.match(client, /data-penglai-im-action-error/);
  assert.match(client, /微信未接受原生语音测试，已保持音频附件回退/);
  assert.match(client, /语音设置保存失败，请刷新状态后重试/);
});

test("R50-WX-002/R50-FS-001/012 IM client has Weixin and Feishu official QR", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  for (const state of ["pending", "scanned", "confirmed", "expired", "need-verification", "failed", "cancelled"]) {
    assert.match(client, new RegExp(state));
  }
  assert.match(client, /data-penglai-im-qr-state/);
  assert.match(client, /data-penglai-feishu-wizard/);
  assert.match(client, /data-penglai-feishu-app-id/);
  assert.match(client, /data-penglai-feishu-console/);
  assert.match(client, /https:\/\/open\.feishu\.cn\/app/);
  assert.match(client, /data-penglai-im-goto-weixin/);
  assert.match(client, /data-penglai-im-goto-feishu/);
  assert.match(client, /configureFeishu/);
  assert.match(client, /setFeishuOwner/);
  assert.match(client, /data-penglai-feishu-owner-id/);
  assert.match(client, /beginFeishuQr/);
  assert.match(client, /data-penglai-feishu-qr-begin/);
  assert.match(client, /data:image\\\/png;base64,/);
  assert.equal(client.includes("beginDeviceFlow"), false);
  assert.equal(client.includes("https:\\/\\/"), false);
});

test("R2I-IMCORE-002 PenglaiImRemote uses Typert @Remote methods", () => {
  const ctx = new Context();
  const rt = createRuntime({
    dbPath: ":memory:",
    host: {
      version: "0.1.1-rc.2",
      getAgent: () => undefined,
      listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s1"] }],
    },
  });
  const vault = new CredentialsServiceVault(undefined);
  const weixin = {
    health: () => ({ authState: "idle" as const, hasCredential: false }),
    startQr: async () => ({ qrRef: "q" }),
    poll: async () => "waiting" as const,
    logout: async () => undefined,
    startReceive: async () => undefined,
    stopReceive: () => undefined,
    pumpOutbox: async () => undefined,
  };
  const feishu = { status: "idle", setupRequired: true };
  const supervisor = { running: false, start: async () => undefined, stop: () => undefined };
  const host = new PenglaiImHost(rt.store, rt.plane, weixin as never, feishu as never, vault, supervisor as never, {
    version: "0.1.1-rc.2",
    getAgent: () => undefined,
    listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s1"] }],
  });
  const remote = new PenglaiImRemote(ctx, host);
  const methods = remoteMethods(remote).map((m) => m.method);
  assert.ok(methods.includes("getOverview"));
  assert.ok(methods.includes("beginWeixinQr"));
  assert.ok(methods.includes("pollWeixinQr"));
  assert.ok(methods.includes("probeWeixinText"));
  assert.ok(methods.includes("configureFeishu"));
  assert.ok(methods.includes("setFeishuOwner"));
  assert.ok(methods.includes("beginFeishuQr"));
  assert.equal(methods.includes("proveCausalRoute"), false);
  assert.equal(methods.includes("beginDeviceFlow"), false);
  rt.store.close();
});

test("R2I-CRED-006 production vault refuses MemoryVault fallback", async () => {
  const vault = new CredentialsServiceVault(undefined);
  await assert.rejects(() => vault.write("penglai-im/weixin/default/token", "secret"), PenglaiError);
  assert.equal(await vault.read("penglai-im/weixin/default/token"), undefined);
});

test("weixin QR connected starts receive so the scanner can talk immediately", async () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: {
      version: "0.1.1-rc.2",
      getAgent: () => undefined,
      listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
    },
  });
  let receives = 0;
  const weixin = {
    health: () => ({ authState: "connected" as const, hasCredential: true }),
    poll: async () => "connected" as const,
    startReceive: async () => {
      receives += 1;
    },
    stopReceive: () => undefined,
    pumpOutbox: async () => undefined,
  };
  const supervisor = {
    running: true,
    start: async () => undefined,
    restartWeixinReceive: async () => {
      await weixin.startReceive();
    },
    stop: () => undefined,
  };
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    weixin as never,
    { status: "connected", setupRequired: false } as never,
    new CredentialsServiceVault(undefined),
    supervisor as never,
    {
      version: "0.1.1-rc.2",
      getAgent: () => undefined,
      listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
    },
  );
  const polled = await host.pollWeixinQr({ challengeId: "qr-1" });
  assert.equal(polled.status, "connected");
  assert.equal(receives, 1);
  const overview = await host.getOverview();
  assert.equal(overview.channels.find((c) => c.channel === "feishu")?.connection, "connected");
  rt.store.close();
});

test("R2I-ROUTE-001 binding requires official workspace/session", async () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: {
      version: "0.1.1-rc.2",
      getAgent: () => undefined,
      listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s1"] }],
    },
  });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle", hasCredential: false }) } as never,
    { status: "idle", setupRequired: true } as never,
    new CredentialsServiceVault(undefined),
    { running: false, start: async () => undefined, stop: () => undefined } as never,
    {
      version: "0.1.1-rc.2",
      getAgent: () => undefined,
      listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s1"] }],
    },
  );
  assert.throws(
    () =>
      host.createBinding({
        channel: "weixin",
        accountId: "a",
        peerId: "p",
        workspaceId: "missing",
        sessionId: "s1",
      }),
    PenglaiError,
  );
  const binding = host.createBinding({
    channel: "weixin",
    accountId: "a",
    peerId: "p",
    workspaceId: "w",
    sessionId: "s1",
  });
  assert.equal(binding.sessionId, "s1");
  assert.equal(host.listBindings().length, 1);
  rt.store.close();
});

test("R2I-ROUTE packaged causal Message→Turn→route stays on original route", async () => {
  const agent = {
    id: "s1",
    followup(message: { id?: string; source: { kind: "penglai-im"; schema: 1; routeId: string; inboundId: string; adapter: "weixin" } }) {
      rt.plane.onClaimed({
        dshMessageId: String(message.id ?? "m1"),
        turnId: "7",
        sessionId: "s1",
        source: message.source,
      });
      rt.plane.onAssistantFinal({ sessionId: "s1", turnId: "7", text: "token penglai-causal-ok" });
    },
    steer() {},
    cancel() {},
    inbox: { remove() { return true; } },
  };
  const hostLike = {
    version: "0.1.1-rc.2" as const,
    getAgent: () => agent,
    listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s1"] }],
  };
  const rt = createRuntime({ dbPath: ":memory:", host: hostLike });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle", hasCredential: false }) } as never,
    { status: "idle", setupRequired: true } as never,
    new CredentialsServiceVault(undefined),
    { running: false, start: async () => undefined, stop: () => undefined } as never,
    hostLike,
  );
  const proof = await runTestOnlyCausalRoute(host, { workspaceId: "w", sessionId: "s1" });
  assert.equal(proof.causalRoute, true);
  assert.equal(proof.turnId, "7");
  assert.equal(proof.routeId.startsWith("route:weixin:"), true);
  assert.match(proof.reply, /penglai-causal-ok/);
  rt.store.close();
});

test("R2I-UI-001 client registers Penglai IM page sections", () => {
  const c = contribute();
  assert.equal(c.slot, "settings.section");
  assert.deepEqual(c.sections, ["总览", "微信", "飞书", "绑定", "命令", "诊断"]);
});

test("R2I-CRED-007 IM credential refs are official POSIX identifiers and vault rejects invalid refs", async () => {
  const { WEIXIN_TOKEN_REF, FEISHU_SECRET_REF } = await import("./credentials-vault.js");
  const official = /^[A-Za-z_][A-Za-z0-9_]*$/;
  assert.match(WEIXIN_TOKEN_REF, official);
  assert.match(FEISHU_SECRET_REF, official);
  const store = new Map<string, string>();
  const credentials = {
    async set(ref: string, value: string) { store.set(ref, value); },
    async describe(ref: string) { return { configured: store.has(ref), source: "yaml", writable: true }; },
    async resolve(ref: string) { return store.has(ref) ? { value: store.get(ref) as string, source: "yaml" } : undefined; },
    async unset(ref: string) { store.delete(ref); },
  };
  const vault = new CredentialsServiceVault(credentials);
  await vault.write(WEIXIN_TOKEN_REF, "tok");
  await vault.write(FEISHU_SECRET_REF, "app-secret");
  assert.equal((await vault.describe(WEIXIN_TOKEN_REF)).configured, true);
  assert.equal((await vault.describe(FEISHU_SECRET_REF)).configured, true);
  await assert.rejects(() => vault.write("penglai-im/weixin/default/token", "x"), PenglaiError);
  await assert.rejects(() => vault.write("penglai-im/feishu/default/app-secret", "x"), PenglaiError);
});

test("R2I-CRED-008 legacy weixin-bot-token migrates to canonical ref and supervisor resumes receive", async () => {
  const { WEIXIN_TOKEN_CREDENTIAL_REF, migrateWeixinTokenRef, LEGACY_WEIXIN_TOKEN_REF } = await import("../../channel-weixin/src/index.js");
  const { WEIXIN_TOKEN_REF } = await import("./credentials-vault.js");
  assert.equal(WEIXIN_TOKEN_CREDENTIAL_REF, WEIXIN_TOKEN_REF);
  const store = new Map<string, string>([[LEGACY_WEIXIN_TOKEN_REF, "legacy-tok"]]);
  const credentials = {
    async set(ref: string, value: string) { store.set(ref, value); },
    async describe(ref: string) { return { configured: store.has(ref), source: "yaml", writable: true }; },
    async resolve(ref: string) { return store.has(ref) ? { value: store.get(ref) as string, source: "yaml" } : undefined; },
    async unset(ref: string) { store.delete(ref); },
  };
  const vault = new CredentialsServiceVault(credentials);
  const migrated = await migrateWeixinTokenRef(vault);
  assert.equal(migrated, true);
  assert.equal(store.get(WEIXIN_TOKEN_REF), "legacy-tok");
  assert.equal(store.has(LEGACY_WEIXIN_TOKEN_REF), false);
  assert.equal((await vault.describe(WEIXIN_TOKEN_REF)).configured, true);
  const empty = await migrateWeixinTokenRef(new CredentialsServiceVault({
    async set() {}, async describe() { return { configured: false }; },
    async resolve() { return undefined; }, async unset() {},
  }));
  assert.equal(empty, false);
});

test("R2I-CRED-009 feishu secret write/read via host round-trips without plaintext in overview", async () => {
  const { FEISHU_SECRET_REF } = await import("./credentials-vault.js");
  const store = new Map<string, string>();
  const credentials = {
    async set(ref: string, value: string) { store.set(ref, value); },
    async describe(ref: string) { return { configured: store.has(ref), source: "yaml", writable: true }; },
    async resolve(ref: string) { return store.has(ref) ? { value: store.get(ref) as string, source: "yaml" } : undefined; },
    async unset(ref: string) { store.delete(ref); },
  };
  const vault = new CredentialsServiceVault(credentials);
  const rt = createRuntime({
    dbPath: ":memory:",
    host: { version: "0.1.1-rc.2", getAgent: () => undefined, listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }] },
  });
  const feishu = { status: "idle", setupRequired: false, connect: async () => undefined, stop() {} };
  const host = new PenglaiImHost(rt.store, rt.plane, { health: () => ({ authState: "idle", hasCredential: false }) } as never, feishu as never, vault, { running: false, start: async () => undefined, stop: () => undefined } as never, { version: "0.1.1-rc.2", getAgent: () => undefined, listWorkspaces: () => [] });
  const configured = await host.configureFeishu({ appId: "cli_x", secret: "fixture-secret-not-real" });
  assert.equal(configured.configured, true);
  assert.equal(store.get(FEISHU_SECRET_REF), "fixture-secret-not-real");
  assert.equal(store.has("penglai-im/feishu/default/app-secret"), false);
  const overview = JSON.stringify(await host.getOverview());
  assert.equal(overview.includes("fixture-secret-not-real"), false);
  rt.store.close();
});

test("Feishu owner is required for inbound and persists without appearing in overview", async () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: { version: "0.1.1-rc.2", getAgent: () => undefined, listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }] },
  });
  const vault = new CredentialsServiceVault({
    async set() {},
    async describe() { return { configured: true, source: "local", writable: true }; },
    async resolve() { return { configured: true, source: "local" }; },
    async unset() {},
  } as never);
  let owner = "";
  let source = "";
  const feishu = {
    status: "idle",
    setupRequired: true,
    ownerKnown: false,
    setOwner(openId: string, nextSource: string) {
      owner = openId;
      source = nextSource;
      this.ownerKnown = true;
    },
    getOwnerOpenId() { return owner || undefined; },
    setAppId() {},
    takeQrCredentials() {
      return { appId: "cli_scan", appSecret: "scan-secret", ownerOpenId: "ou_scanner_owner" };
    },
    pollQr: async () => ({ status: "confirmed" as const }),
    connect: async () => { feishu.status = "connected"; },
    stop() {},
  };
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle" as const, hasCredential: false }) } as never,
    feishu as never,
    vault,
    { running: false, start: async () => undefined, stop: () => undefined } as never,
    { version: "0.1.1-rc.2", getAgent: () => undefined, listWorkspaces: () => [] },
  );
  await host.configureFeishu({ appId: "cli_manual" });
  const before = await host.getOverview();
  assert.equal(before.feishuOwnerKnown, false);
  assert.equal(JSON.parse(rt.store.getAdapterConfig("feishu-default") ?? "{}").ownerOpenId, undefined);

  host.setFeishuOwner({ openId: "ou_manual_owner" });
  assert.equal(owner, "ou_manual_owner");
  assert.equal(source, "explicit");
  const after = await host.getOverview();
  assert.equal(after.feishuOwnerKnown, true);
  assert.equal(JSON.stringify(after).includes("ou_manual_owner"), false);
  assert.equal(JSON.parse(rt.store.getAdapterConfig("feishu-default") ?? "{}").ownerOpenId, "ou_manual_owner");

  await host.pollFeishuQr({ challengeId: "fsqr_1" });
  assert.equal(owner, "ou_scanner_owner");
  assert.equal(source, "registration");
  rt.store.close();
});
