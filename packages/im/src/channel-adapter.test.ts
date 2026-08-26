import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnerApprovalBroker } from "@penglai/runtime";
import { CHANNEL_IDS, LIVE_CHANNEL_IDS, refuseFakeQr } from "./registry.js";
import { assertLiveSend, guidedAdapter } from "./channel-adapter.js";
import { createRuntime } from "./index.js";
import { PenglaiImHost } from "./host.js";
import { CredentialsServiceVault } from "./credentials-vault.js";
import { IM_OWNER_ACTIONS } from "./owner.js";

test("non-live channels refuse send and never mint a fake QR", async () => {
  for (const id of CHANNEL_IDS) {
    if ((LIVE_CHANNEL_IDS as readonly string[]).includes(id)) continue;
    const adapter = guidedAdapter(id);
    assert.equal(adapter.id, id);
    const method = adapter.manifest().connectionMethods.find((row) => row !== "qr") ?? adapter.manifest().connectionMethods[0]!;
    const begun = await adapter.beginConnection({ method, riskAck: true });
    assert.equal(begun.kind, method === "manual-fallback" ? "manual-fallback" : method);
    assert.equal(begun.live, false);
    const health = await adapter.health();
    assert.equal(health.live, false);
    assert.equal(health.enabled, true);
    assert.equal(adapter.manifest().id, id);
    await assert.rejects(() => adapter.sendText({ text: "hi" }), /CHANNEL_NOT_LIVE/);
    await assert.rejects(() => adapter.sendArtifact({ artifactId: "sha256:" + "a".repeat(64) }), /CHANNEL_NOT_LIVE/);
    assert.throws(() => assertLiveSend(id), /CHANNEL_NOT_LIVE/);
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
  assert.equal(health.connection === "disabled" || health.connection === "not_configured", true);
});

test("IM host registers guided adapters and refuses non-live outbound text", async () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: { version: "0.1.1-rc.2", getAgent: () => undefined, listWorkspaces: () => [] },
  });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle", hasCredential: false }) } as never,
    { status: "idle", setupRequired: true } as never,
    new CredentialsServiceVault(undefined),
    { running: false, start: async () => undefined, stop: () => undefined } as never,
    { version: "0.1.1-rc.2", getAgent: () => undefined, listWorkspaces: () => [] },
  );
  await assert.rejects(() => host.sendOutboundText({ channel: "dingtalk", text: "hi" }), /CHANNEL_NOT_LIVE/);
  await assert.rejects(() => host.sendOutboundText({ channel: "wecom", text: "hi" }), /CHANNEL_NOT_LIVE/);
  await assert.rejects(() => host.sendOutboundText({ channel: "qq", text: "hi" }), /CHANNEL_NOT_LIVE/);
  await assert.rejects(() => host.sendOutboundText({ channel: "weixin", text: "hi" }), /LIVE_CHANNEL_USES_NATIVE_OUTBOX/);
  rt.store.close();
});

test("restore applies persisted Telegram offset before reconnect", async () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: { version: "0.1.1-rc.2", getAgent: () => undefined, listWorkspaces: () => [] },
  });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle", hasCredential: false }) } as never,
    { status: "idle", setupRequired: true } as never,
    new CredentialsServiceVault(undefined),
    { running: false, start: async () => undefined, stop: () => undefined } as never,
    { version: "0.1.1-rc.2", getAgent: () => undefined, listWorkspaces: () => [] },
  );
  const { TelegramAdapter } = await import("@penglai/channel-telegram");
  const { telegramChannelAdapter } = await import("./adapters/channel-bridge.js");
  const telegram = new TelegramAdapter({ resolve: () => undefined });
  host.attachChannelAdapter(telegramChannelAdapter(telegram, { hashPeer: (senderId) => senderId }));
  rt.store.putAdapterConfig("cfg:telegram", "telegram", JSON.stringify({ enabled: true, updateOffset: 42 }));
  await host.restoreChannelAdapters();
  assert.equal(telegram.getUpdateOffset(), 42);
  rt.store.close();
});

test("WhatsApp owner risk approval is consumed before device-link and logout wipes once", async () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: { version: "0.1.1-rc.2", getAgent: () => undefined, listWorkspaces: () => [] },
  });
  const owner = new OwnerApprovalBroker(mkdtempSync(join(tmpdir(), "penglai-im-whatsapp-owner-")), {
    dialog: async () => "approved",
  });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle", hasCredential: false }) } as never,
    { status: "idle", setupRequired: true } as never,
    new CredentialsServiceVault(undefined),
    { running: false, start: async () => undefined, stop: () => undefined } as never,
    { version: "0.1.1-rc.2", getAgent: () => undefined, listWorkspaces: () => [] },
  );
  let beginCalls = 0;
  let credentialWipes = 0;
  let rawLogoutCalls = 0;
  host.attachChannelAdapter({
    id: "whatsapp",
    manifest: () => guidedAdapter("whatsapp").manifest(),
    enable: async () => undefined,
    disable: async () => undefined,
    beginConnection: async () => {
      beginCalls += 1;
      return { kind: "device-link", live: false, operationId: "wa:device-link" };
    },
    pollConnection: async () => ({ status: "connecting" }),
    cancelConnection: async () => undefined,
    start: async () => undefined,
    stop: async () => undefined,
    health: async () => ({ channel: "whatsapp", live: false, enabled: true, connection: "connecting" }),
    sendText: async () => ({ delivered: true }),
    sendArtifact: async () => ({ delivered: true }),
    disconnect: async () => undefined,
    logout: async () => {
      rawLogoutCalls += 1;
    },
    deleteCredentials: async () => {
      credentialWipes += 1;
    },
    onInbound: () => undefined,
    capabilities: () => guidedAdapter("whatsapp").capabilities(),
  });
  host.attachOwner(owner);

  const risk = host.proposeBinding({ action: IM_OWNER_ACTIONS.acknowledgeRisk, objectId: "whatsapp" });
  const approvedRisk = await owner.requestOwnerApproval(risk.actionId);
  assert.equal(approvedRisk.decision, "approved");
  await assert.rejects(
    () =>
      host.beginChannelConnection({
        channel: "whatsapp",
        method: "device-link",
        riskAck: true,
        riskOwnerActionId: risk.actionId,
        riskReceipt: "forged.receipt",
      }),
    /OWNER_RECEIPT/,
  );
  assert.equal(beginCalls, 0, "forged owner proof must not start the device-link SDK");

  await host.beginChannelConnection({
    channel: "whatsapp",
    method: "device-link",
    riskAck: true,
    riskOwnerActionId: risk.actionId,
    riskReceipt: approvedRisk.decision === "approved" ? approvedRisk.receipt : "",
  });
  assert.equal(beginCalls, 1);
  assert.equal(owner.inspect(risk.actionId).state, "committed");

  const logout = host.proposeBinding({ action: IM_OWNER_ACTIONS.logout, objectId: "whatsapp" });
  const approvedLogout = await owner.requestOwnerApproval(logout.actionId);
  assert.equal(approvedLogout.decision, "approved");
  await host.logoutChannel({
    channel: "whatsapp",
    ownerActionId: logout.actionId,
    receipt: approvedLogout.decision === "approved" ? approvedLogout.receipt : "",
  });
  assert.equal(credentialWipes, 1);
  assert.equal(rawLogoutCalls, 0, "deleteCredentials owns the adapter logout/wipe sequence");
  assert.equal(owner.inspect(logout.actionId).state, "committed");
  rt.store.close();
});
