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
import { createRuntime } from "./index.js";
import { CredentialsServiceVault } from "./credentials-vault.js";
import { PenglaiImHost } from "./host.js";

test("R56-IM-001/002 registry lists nine platforms and keeps Weixin/Feishu as the only live channels", () => {
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
  assert.equal(CHANNEL_MANIFESTS.slack.live, false);
  assert.equal(CHANNEL_MANIFESTS.telegram.connectionMethods.includes("qr"), false);
  assert.equal(CHANNEL_MANIFESTS.discord.connectionMethods.includes("qr"), false);
  assert.equal(CHANNEL_MANIFESTS.whatsapp.defaultEnabled, false);
  assert.equal(CHANNEL_MANIFESTS.whatsapp.risk, "community-protocol");
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
  assert.equal(rt.store.schemaVersion(), 11);
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

test("R56-IM-008 IM client lists nine platforms and does not invent Slack/Telegram/Discord QR", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(client, /data-penglai-im-platforms/);
  assert.match(client, /data-penglai-im-platform/);
  assert.match(client, /guidedConnect/);
  assert.match(client, /This platform has no QR shortcut/);
  assert.match(client, /该平台没有二维码捷径/);
  assert.match(client, /data-penglai-im-whatsapp-risk/);
  assert.match(client, /beginGuidedConnection/);
  assert.doesNotMatch(client, /slackQr|telegramQr|discordQr|beginSlackQr|beginTelegramQr/);
  assert.match(client, /data-penglai-im-goto-weixin/);
  assert.match(client, /data-penglai-im-goto-feishu/);
  assert.match(client, /beginWeixinQr/);
  assert.match(client, /beginFeishuQr/);
});
