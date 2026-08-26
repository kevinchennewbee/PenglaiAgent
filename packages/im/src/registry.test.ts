import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SCHEMA_VERSION } from "@penglai/contracts";
import { Store } from "@penglai/persistence";
import { ImBotStore } from "./bots.js";
import { beginGuidedConnection } from "./guided.js";
import { CHANNEL_IDS, CHANNEL_MANIFESTS, refuseFakeQr } from "./registry.js";
import { OwnerApprovalBroker } from "@penglai/runtime";
import { createRuntime } from "./index.js";
import { CredentialsServiceVault } from "./credentials-vault.js";
import { PenglaiImHost } from "./host.js";

test("R57-IM-001/002 registry lists nine implemented platforms", () => {
  assert.deepEqual([...CHANNEL_IDS], [
    "weixin",
    "feishu",
    "dingtalk",
    "wecom",
    "qq",
    "slack",
    "telegram",
    "discord",
    "whatsapp",
  ]);
  assert.equal(CHANNEL_MANIFESTS.weixin.live, true);
  assert.equal(CHANNEL_MANIFESTS.feishu.live, true);
  assert.equal(CHANNEL_MANIFESTS.weixin.connectionMethods.includes("qr"), true);
  for (const row of Object.values(CHANNEL_MANIFESTS)) assert.equal(row.live, true);
  assert.equal(CHANNEL_MANIFESTS.telegram.connectionMethods.includes("qr"), false);
  assert.equal(CHANNEL_MANIFESTS.discord.connectionMethods.includes("qr"), false);
  assert.equal(CHANNEL_MANIFESTS.whatsapp.defaultEnabled, false);
  assert.equal(CHANNEL_MANIFESTS.whatsapp.risk, "community-protocol");
  assert.equal(CHANNEL_MANIFESTS.whatsapp.supportLevel, "experimental");
  assert.equal(CHANNEL_MANIFESTS.slack.capabilities.threads, false);
  assert.equal(CHANNEL_MANIFESTS.dingtalk.connectionMethods.includes("qr"), true);
  assert.equal(CHANNEL_MANIFESTS.wecom.connectionMethods.includes("qr"), true);
  assert.equal(CHANNEL_MANIFESTS.qq.connectionMethods.includes("qr"), true);
});

test("R56-IM-003 Slack/Telegram/Discord refuse a fake QR connection", () => {
  assert.throws(() => refuseFakeQr("slack", "qr"), /CHANNEL_NO_QR/);
  assert.throws(() => beginGuidedConnection({ channel: "telegram", method: "qr" }), /CHANNEL_NO_QR/);
  assert.throws(() => beginGuidedConnection({ channel: "discord", method: "qr" }), /CHANNEL_NO_QR/);
  const slack = beginGuidedConnection({ channel: "slack", method: "oauth" });
  assert.equal(slack.qr, false);
  assert.equal(slack.live, false);
});

test("R56-IM-019 WhatsApp stays disabled until an explicit risk acknowledgement", () => {
  assert.throws(() => beginGuidedConnection({ channel: "whatsapp", method: "device-link" }), /CHANNEL_RISK_ACK/);
  const dir = mkdtempSync(join(tmpdir(), "penglai-im-bots-"));
  const store = new Store(join(dir, "im.sqlite"));
  const bots = new ImBotStore(store.db);
  assert.throws(() => bots.create({ channelId: "whatsapp", displayName: "WA" }), /CHANNEL_RISK_ACK/);
  const row = bots.create({ channelId: "whatsapp", displayName: "WA", riskAck: true });
  assert.equal(row.state, "disabled");
  assert.ok(row.riskAckAt);
  assert.equal(store.schemaVersion(), SCHEMA_VERSION);
  store.close();
});

test("R57-IM-002 host begins a real Slack token connection without QR", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-im-connect-"));
  const rt = createRuntime({
    dbPath: join(dir, "im.sqlite"),
    host: {
      version: "0.1.1-rc.2",
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
    { version: "0.1.1-rc.2", getAgent: () => undefined, listWorkspaces: () => [] },
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
  assert.equal(begun.live, false);
  assert.equal((await host.getOverview()).channels.find((row) => row.channel === "slack")?.connection, "connected");
  assert.equal(JSON.stringify(begun).includes("xoxb-test"), false);
  rt.store.close();
});

test("sidecar credential writes require an owner receipt when the broker is attached", async () => {
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
    { version: "0.1.1-rc.2", getAgent: () => undefined, listWorkspaces: () => [] },
  );
  host.createBot({ channelId: "slack", displayName: "docs" });
  const overview = await host.getOverview();
  assert.equal(overview.channels.length, 9);
  assert.equal(overview.manifests.length, 9);
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
    /CHANNEL_NOT_LIVE/,
  );
  rt.store.close();
});

test("R57-IM-002 IM client lists nine platforms with a real connect action", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(client, /data-penglai-im-platforms/);
  assert.match(client, /data-penglai-im-platform/);
  assert.match(client, /beginChannelConnection/);
  assert.match(client, /data-penglai-im-connect-submit/);
  assert.match(client, /Boolean\(operationId\)/);
  assert.match(client, /data-penglai-im-connect-cancel/);
  assert.match(client, /data-penglai-im-connect-status/);
  assert.match(client, /channel\.risk === "community-protocol" && !riskAck/);
  assert.match(client, /if \(!usesQr \|\| autoStarted \|\| channel\.risk === "community-protocol"\) return/);
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
  assert.match(client, /im.acknowledgeRisk/);
  assert.match(client, /im.logout/);
  assert.doesNotMatch(client, /credential ref/);
  assert.match(client, /overflowWrap/);
  assert.match(client, /data-penglai-im-status/);
  assert.match(client, /data-penglai-im-card-header/);
  assert.match(client, /data-penglai-im-implemented/);
  assert.doesNotMatch(client, /0\.5\.7 可用|Available in 0\.5\.7/);
  assert.match(client, /data-penglai-im-advanced/);
  assert.match(client, /displayName/);
});
