import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { beginGuidedConnection } from "./guided.js";
import { ImBotStore } from "./bots.js";
import { CHANNEL_IDS, CHANNEL_MANIFESTS, NATIVE_CHANNEL_IDS, refuseFakeQr } from "./registry.js";
import { OwnerApprovalBroker } from "@penglai/runtime";
import { createRuntime } from "./index.js";
import { CredentialsServiceVault } from "./credentials-vault.js";
import { PenglaiImHost } from "./host.js";

test("R58-IM-001 registry lists exactly eight supported connectors", () => {
  assert.deepEqual([...CHANNEL_IDS], [
    "weixin",
    "feishu",
    "dingtalk",
    "wecom",
    "qq",
    "slack",
    "telegram",
    "discord",
  ]);
  assert.deepEqual([...NATIVE_CHANNEL_IDS], ["weixin", "feishu"]);
  assert.equal(CHANNEL_MANIFESTS.weixin.adapterMode, "native");
  assert.equal(CHANNEL_MANIFESTS.feishu.adapterMode, "native");
  assert.equal(CHANNEL_MANIFESTS.weixin.connectionMethods.includes("qr"), true);
  for (const row of Object.values(CHANNEL_MANIFESTS)) {
    assert.equal(row.entryAvailable, true);
    assert.equal(row.runtimeBundled, true);
    assert.equal(row.releaseEvidence, "source-only");
    assert.notEqual(row.connectionMethods.length, 0);
    assert.equal(Object.isFrozen(row), true);
    assert.equal("live" in row, false);
    assert.equal("supportLevel" in row, false);
    assert.equal("capabilities" in row, false);
  }
  assert.equal(CHANNEL_MANIFESTS.telegram.connectionMethods.includes("qr"), false);
  assert.equal(CHANNEL_MANIFESTS.discord.connectionMethods.includes("qr"), false);
  assert.equal(CHANNEL_MANIFESTS.slack.capabilityEvidence.image, "not-supported");
  assert.equal(CHANNEL_MANIFESTS.slack.capabilityEvidence.reconnect, "source-tested");
  assert.equal(CHANNEL_MANIFESTS.dingtalk.connectionMethods.includes("qr"), true);
  assert.equal(CHANNEL_MANIFESTS.wecom.connectionMethods.includes("qr"), true);
  assert.equal(CHANNEL_MANIFESTS.qq.connectionMethods.includes("qr"), true);
});

test("unsupported legacy bot rows stay stored but cannot re-enter the active registry", () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: { version: "0.1.2-alpha.1", getAgent: () => undefined, listWorkspaces: () => [] },
  });
  const bots = new ImBotStore(rt.store.db);
  rt.store.db
    .prepare(
      "INSERT INTO im_v2_bots(bot_id, channel_id, display_name, credential_ref, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run("legacy-bot", "retired-channel", "Legacy", "RETIRED_CREDENTIAL", "disabled", 1, 1);
  assert.deepEqual(bots.list(), []);
  assert.throws(() => bots.list("retired-channel"), /UNKNOWN_CHANNEL_ID/);
  assert.equal(rt.store.db.prepare("SELECT COUNT(*) AS count FROM im_v2_bots WHERE bot_id=?").get("legacy-bot")?.count, 1);
  rt.store.close();
});

test("R56-IM-003 Slack/Telegram/Discord refuse a fake QR connection", () => {
  assert.throws(() => refuseFakeQr("slack", "qr"), /CHANNEL_NO_QR/);
  assert.throws(() => beginGuidedConnection({ channel: "telegram", method: "qr" }), /CHANNEL_NO_QR/);
  assert.throws(() => beginGuidedConnection({ channel: "discord", method: "qr" }), /CHANNEL_NO_QR/);
  const slack = beginGuidedConnection({ channel: "slack", method: "oauth" });
  assert.equal(slack.qr, false);
  assert.equal(slack.connection, "not_configured");
});

test("R57-IM-002 host begins a real Slack token connection without QR", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-im-connect-"));
  const rt = createRuntime({
    dbPath: join(dir, "im.sqlite"),
    host: {
      version: "0.1.2-alpha.1",
      getAgent: () => undefined,
      listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s1"] }],
    },
  });
  const memory = new Map<string, string>();
  const vault = new CredentialsServiceVault({
    async set(ref, value) {
      memory.set(ref, value);
    },
    async describe(ref) {
      return { configured: memory.has(ref), writable: true };
    },
    async resolve(ref) {
      return memory.has(ref) ? { value: memory.get(ref) as string } : undefined;
    },
    async unset(ref) {
      memory.delete(ref);
    },
  });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle", hasCredential: false }) } as never,
    { status: "idle", setupRequired: true } as never,
    vault,
    { running: false, start: async () => undefined, stop: () => undefined } as never,
    { version: "0.1.2-alpha.1", getAgent: () => undefined, listWorkspaces: () => [] },
  );
  const slackCreds: Record<string, { botToken: string; appToken?: string }> = {};
  host.attachSecretHydrator((id, serialized) => {
    if (id === "slack") slackCreds["PENGLAI_SLACK_BOT"] = JSON.parse(serialized) as { botToken: string; appToken?: string };
  });
  const slack = new (await import("@penglai/channel-slack")).SlackAdapter(
    { resolve: (ref) => slackCreds[ref] },
    async (url) => {
      if (String(url).includes("apps.connections.open")) {
        return new Response(JSON.stringify({ ok: true, url: "wss://wss-primary.slack.com/link" }));
      }
      return new Response(JSON.stringify({ ok: true }));
    },
    {
      open: (_url, onEvent) => {
        onEvent({ type: "hello" });
        return { close() {} };
      },
    },
  );
  const { slackChannelAdapter } = await import("./adapters/channel-bridge.js");
  host.attachChannelAdapter(slackChannelAdapter(slack, { hashPeer: (senderId) => senderId }));
  await assert.rejects(() => host.beginChannelConnection({ channel: "slack", method: "qr" }), /CHANNEL_NO_QR/);
  const begun = await host.beginChannelConnection({
    channel: "slack",
    method: "token",
    secret: JSON.stringify({ botToken: "xoxb-test", appToken: "xapp-test" }),
  });
  assert.equal(begun.kind, "token");
  assert.equal(begun.connection, "connecting");
  assert.equal((await host.getOverview()).channels.find((row) => row.channel === "slack")?.connection, "connected");
  assert.equal(JSON.stringify(begun).includes("xoxb-test"), false);
  rt.store.close();
});

test("sidecar credential writes require an owner receipt when the broker is attached", async () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: { version: "0.1.2-alpha.1", getAgent: () => undefined, listWorkspaces: () => [] },
  });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle", hasCredential: false }) } as never,
    { status: "idle", setupRequired: true } as never,
    new CredentialsServiceVault(undefined),
    { running: false, start: async () => undefined, stop: () => undefined } as never,
    { version: "0.1.2-alpha.1", getAgent: () => undefined, listWorkspaces: () => [] },
  );
  const root = mkdtempSync(join(tmpdir(), "penglai-im-secret-owner-"));
  host.attachOwner(new OwnerApprovalBroker(root, { dialog: async () => "approved" }));
  await assert.rejects(
    () => host.storeChannelSecret({ channel: "telegram", secret: "tok-test" }),
    /IM_OWNER_ACTION/,
  );
  await assert.rejects(() => host.logoutChannel({ channel: "telegram" }), /IM_OWNER_ACTION/);
  rt.store.close();
});

test("R56-IM-007 sidecar bots do not bump the v11 IM schema or get misread as Weixin", async () => {
  const rt = createRuntime({
    dbPath: ":memory:",
    host: {
      version: "0.1.2-alpha.1",
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
    { version: "0.1.2-alpha.1", getAgent: () => undefined, listWorkspaces: () => [] },
  );
  host.createBot({ channelId: "slack", displayName: "docs" });
  const overview = await host.getOverview();
  assert.equal(overview.channels.length, 8);
  assert.equal(overview.manifests.length, 8);
  for (const state of overview.channels) {
    assert.equal("live" in state, false);
    assert.equal(state.entryAvailable, true);
    assert.equal(state.runtimeBundled, true);
    assert.equal(state.releaseEvidence, "source-only");
    assert.equal(typeof state.capabilityEvidence.authentication, "string");
  }
  assert.equal(rt.store.schemaVersion(), 12);
  assert.equal(host.listBindings().some((row) => row.channel === "weixin" && row.accountId === "docs"), false);
  assert.throws(
    () =>
      host.createBinding({
        channel: "slack" as never,
        accountId: "a",
        peerId: "p",
        workspaceId: "w",
        sessionId: "s1",
      }),
    /CHANNEL_BINDING_UNAVAILABLE/,
  );
  rt.store.close();
});

test("R58-IM-002 IM client lists eight connect actions without a compatibility card", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(client, /data-penglai-im-platforms/);
  assert.match(client, /data-penglai-im-platform/);
  assert.match(client, /beginChannelConnection/);
  assert.match(client, /data-penglai-im-connect-submit/);
  assert.doesNotMatch(client, /data-penglai-im-runtime-not-bundled/);
  assert.doesNotMatch(client, /data-penglai-im-unavailable/);
  assert.match(client, /Boolean\(operationId\)/);
  assert.match(client, /data-penglai-im-connect-cancel/);
  assert.match(client, /data-penglai-im-connect-status/);
  assert.match(client, /function ConnectionModal/);
  assert.match(client, /data-penglai-im-connect-backdrop/);
  assert.match(client, /data-penglai-im-connect-dialog/);
  assert.match(client, /data-penglai-im-connect-close/);
  assert.match(client, /"aria-modal": "true"/);
  assert.match(client, /"aria-labelledby": headingId/);
  assert.match(client, /event\.key === "Escape"/);
  assert.match(client, /position: "fixed"/);
  assert.match(client, /maxHeight: "min\(760px, calc\(100vh - 48px\)\)"/);
  assert.match(client, /data-penglai-im-connect-pane/);
  assert.equal((client.match(/role: "dialog"/g) ?? []).length, 1);
  assert.match(client, /function connectionFailureText/);
  assert.match(client, /data-penglai-im-connect-error-code/);
  assert.match(client, /data-penglai-im-qr-error-reference/);
  assert.match(client, /data-penglai-feishu-qr-error-reference/);
  assert.doesNotMatch(client, /String\(err|err\.message|BOUNDED_HTTP_MIME/);
  assert.match(client, /if \(!usesQr \|\| autoStarted\) return/);
  assert.match(client, /data-penglai-im-scan-image/);
  assert.doesNotMatch(client, /data-penglai-im-scan-host/);
  assert.doesNotMatch(client, /roadmap only/);
  assert.doesNotMatch(client, /仅列入后续计划/);
  assert.doesNotMatch(client, /data-penglai-im-planned/);
  assert.doesNotMatch(client, /slackQr|telegramQr|discordQr|beginSlackQr|beginTelegramQr/);
  assert.match(client, /data-penglai-im-goto-weixin/);
  assert.match(client, /data-penglai-im-goto-feishu/);
  assert.match(client, /beginWeixinQr/);
  assert.match(client, /beginFeishuQr/);
  assert.match(client, /proposeBinding/);
  assert.match(client, /requestOwnerApproval/);
  assert.match(client, /data-penglai-im-version/);
  assert.match(client, /im.saveCredentials/);
  assert.match(client, /im.logout/);
  assert.doesNotMatch(client, /credential ref/);
  assert.match(client, /overflowWrap/);
  assert.match(client, /data-penglai-im-status/);
  assert.match(client, /data-penglai-im-card-header/);
  assert.match(client, /data-penglai-im-release-evidence/);
  assert.match(client, /data-penglai-im-runtime-bundled/);
  assert.match(client, /source evidence only/);
  assert.doesNotMatch(client, /data-penglai-im-live|data-penglai-im-implemented/);
  assert.doesNotMatch(client, /0\.5\.7 可用|Available in 0\.5\.7/);
  assert.match(client, /data-penglai-im-advanced/);
  assert.match(client, /function safeTransportObservation/);
  assert.match(client, /data-penglai-im-safe-transport/);
  assert.match(client, /data-penglai-im-safe-transport-reference/);
  assert.match(client, /Safe response observation \(not a root-cause claim\)/);
  assert.match(client, /安全响应观测（不代表根因）/);
  assert.doesNotMatch(client, /transport\.(?:url|headers|body|authorization)/);
  assert.match(client, /displayName/);
});
