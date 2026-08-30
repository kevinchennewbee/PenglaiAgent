import assert from "node:assert/strict";
import test from "node:test";
import { CHANNEL_IDS, NATIVE_CHANNEL_IDS, refuseFakeQr } from "./registry.js";
import { assertNativeSend, guidedAdapter } from "./channel-adapter.js";
import { createRuntime } from "./index.js";
import { PenglaiImHost } from "./host.js";
import { CredentialsServiceVault } from "./credentials-vault.js";

test("guided channels refuse unavailable send and never mint a fake QR", async () => {
  for (const id of CHANNEL_IDS) {
    if ((NATIVE_CHANNEL_IDS as readonly string[]).includes(id)) continue;
    const adapter = guidedAdapter(id);
    assert.equal(adapter.id, id);
    const method =
      adapter.manifest().connectionMethods.find((row) => row !== "qr") ??
      adapter.manifest().connectionMethods[0]!;
    const begun = await adapter.beginConnection({ method });
    assert.equal(
      begun.kind,
      method === "manual-fallback" ? "manual-fallback" : method,
    );
    assert.equal(begun.connection, "connecting");
    const health = await adapter.health();
    assert.equal(health.runtimeBundled, true);
    assert.equal(health.enabled, true);
    assert.equal(adapter.manifest().id, id);
    await assert.rejects(
      () => adapter.sendText({ text: "hi" }),
      /CHANNEL_TEXT_SEND_UNAVAILABLE/,
    );
    await assert.rejects(
      () => adapter.sendArtifact({ artifactId: "sha256:" + "a".repeat(64) }),
      /CHANNEL_TEXT_SEND_UNAVAILABLE/,
    );
    assert.throws(() => assertNativeSend(id), /CHANNEL_TEXT_SEND_UNAVAILABLE/);
  }
  assert.throws(() => refuseFakeQr("slack", "qr"), /CHANNEL_NO_QR/);
  assert.throws(() => refuseFakeQr("telegram", "qr"), /CHANNEL_NO_QR/);
  assert.throws(() => refuseFakeQr("discord", "qr"), /CHANNEL_NO_QR/);
  const dingtalk = guidedAdapter("dingtalk");
  const qr = await dingtalk.beginConnection({ method: "qr" });
  assert.equal(qr.kind, "qr");
  await dingtalk.logout();
  await dingtalk.deleteCredentials();
  const health = await dingtalk.health();
  assert.equal(
    health.connection === "disabled" || health.connection === "not_configured",
    true,
  );
});

test("IM host registers guided adapters and refuses unavailable outbound text", async () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: {
      version: "0.1.2-alpha.1",
      getAgent: () => undefined,
      listWorkspaces: () => [],
    },
  });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle", hasCredential: false }) } as never,
    { status: "idle", setupRequired: true } as never,
    new CredentialsServiceVault(undefined),
    {
      running: false,
      start: async () => undefined,
      stop: () => undefined,
    } as never,
    {
      version: "0.1.2-alpha.1",
      getAgent: () => undefined,
      listWorkspaces: () => [],
    },
  );
  await assert.rejects(
    () => host.sendOutboundText({ channel: "dingtalk", text: "hi" }),
    /CHANNEL_TEXT_SEND_UNAVAILABLE/,
  );
  await assert.rejects(
    () => host.sendOutboundText({ channel: "wecom", text: "hi" }),
    /CHANNEL_TEXT_SEND_UNAVAILABLE/,
  );
  await assert.rejects(
    () => host.sendOutboundText({ channel: "qq", text: "hi" }),
    /CHANNEL_TEXT_SEND_UNAVAILABLE/,
  );
  await assert.rejects(
    () => host.sendOutboundText({ channel: "weixin", text: "hi" }),
    /NATIVE_CHANNEL_USES_NATIVE_OUTBOX/,
  );
  rt.store.close();
});

test("IM connection waits until real sidecar adapters finish bootstrap", async () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: {
      version: "0.1.2-alpha.1",
      getAgent: () => undefined,
      listWorkspaces: () => [],
    },
  });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle", hasCredential: false }) } as never,
    { status: "idle", setupRequired: true } as never,
    new CredentialsServiceVault(undefined),
    {
      running: false,
      start: async () => undefined,
      stop: () => undefined,
    } as never,
    {
      version: "0.1.2-alpha.1",
      getAgent: () => undefined,
      listWorkspaces: () => [],
    },
  );
  let starts = 0;
  host.attachChannelAdapter({
    ...guidedAdapter("dingtalk"),
    beginConnection: async () => {
      starts += 1;
      return {
        kind: "qr",
        connection: "connecting",
        operationId: "dingtalk:qr",
        expiresAt: Date.now() + 120_000,
      };
    },
  });
  host.deferSidecarOutbox();
  const pending = host.beginChannelConnection({
    channel: "dingtalk",
    method: "qr",
  });
  await Promise.resolve();
  assert.equal(starts, 0);
  host.markSidecarReady();
  await pending;
  assert.equal(starts, 1);
  rt.store.close();
});

test("restore applies persisted Telegram offset before reconnect", async () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: {
      version: "0.1.2-alpha.1",
      getAgent: () => undefined,
      listWorkspaces: () => [],
    },
  });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle", hasCredential: false }) } as never,
    { status: "idle", setupRequired: true } as never,
    new CredentialsServiceVault(undefined),
    {
      running: false,
      start: async () => undefined,
      stop: () => undefined,
    } as never,
    {
      version: "0.1.2-alpha.1",
      getAgent: () => undefined,
      listWorkspaces: () => [],
    },
  );
  const { TelegramAdapter } = await import("@penglai/channel-telegram");
  const { telegramChannelAdapter } =
    await import("./adapters/channel-bridge.js");
  const telegram = new TelegramAdapter({ resolve: () => undefined });
  host.attachChannelAdapter(
    telegramChannelAdapter(telegram, { hashPeer: (senderId) => senderId }),
  );
  rt.store.putAdapterConfig(
    "cfg:telegram",
    "telegram",
    JSON.stringify({ enabled: true, updateOffset: 42 }),
  );
  await host.restoreChannelAdapters();
  assert.equal(telegram.getUpdateOffset(), 42);
  rt.store.close();
});
