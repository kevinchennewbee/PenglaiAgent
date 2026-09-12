import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PenglaiError } from "@penglai/contracts";
import { validateBotAlias } from "./bot-alias.js";
import { ImBotStore } from "./bots.js";
import { createRuntime } from "./index.js";
import { CredentialsServiceVault } from "./credentials-vault.js";
import { PenglaiImHost } from "./host.js";
import { AdapterSupervisor } from "./supervisor.js";
import { TYPERT_REMOTE } from "./remote.js";

test("alias validation trims, bounds, and rejects controls", () => {
  assert.equal(validateBotAlias("  客服助手  "), "客服助手");
  assert.equal(validateBotAlias("  "), "");
  for (const alias of [null, undefined, {}, 1, "x".repeat(81), "foo\nbar", "a\u0000"]) {
    assert.throws(() => validateBotAlias(alias), /IM_BOT_ALIAS_INVALID/);
  }
});

test("store preserves original name, restores empty alias, and does not rewrite credentials", () => {
  const db = new DatabaseSync(":memory:");
  const bots = new ImBotStore(db);
  const created = bots.create({ channelId: "slack", displayName: "Docs Bot" });
  assert.equal(created.displayName, "Docs Bot");
  assert.equal(created.originalDisplayName, "Docs Bot");
  assert.equal(created.alias, undefined);
  const credential = created.credentialRef;
  const renamed = bots.setAlias(created.botId, "  客服助手 ");
  assert.equal(renamed.displayName, "客服助手");
  assert.equal(renamed.alias, "客服助手");
  assert.equal(renamed.originalDisplayName, "Docs Bot");
  assert.equal(renamed.credentialRef, credential);
  assert.equal(renamed.state, created.state);
  const restored = bots.setAlias(created.botId, "  ");
  assert.equal(restored.displayName, "Docs Bot");
  assert.equal(restored.alias, undefined);
  assert.equal(restored.originalDisplayName, "Docs Bot");
  db.close();
});

test("online alias remote does not reconnect adapters or change route identity", async () => {
  const dsh = {
    version: "0.1.5-rc.2",
    getAgent: () => undefined,
    listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
  };
  const rt = createRuntime({ dbPath: ":memory:", host: dsh });
  const weixin = {
    health: () => ({ authState: "connected" as const, hasCredential: true }),
    startReceive: async () => undefined,
    stopReceive: () => undefined,
    pumpOutbox: async () => undefined,
  };
  const feishu = { status: "connected", setupRequired: false };
  let supervisorStarts = 0;
  const supervisor = {
    running: true,
    start: async () => {
      supervisorStarts += 1;
    },
    stop: () => undefined,
    resume: async () => {
      supervisorStarts += 1;
    },
    restartWeixinReceive: async () => {
      supervisorStarts += 1;
    },
  };
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    weixin as never,
    feishu as never,
    new CredentialsServiceVault(undefined),
    supervisor as unknown as AdapterSupervisor,
    dsh,
  );
  const bot = host.createBot({ channelId: "telegram", displayName: "Night Bot" });
  host.bots.setState(bot.botId, "online");
  const before = host.listBots({ channelId: "telegram" })[0];
  const renamed = host.setBotAlias({ botId: bot.botId, alias: "Desk" });
  assert.equal(renamed.displayName, "Desk");
  assert.equal(renamed.originalDisplayName, "Night Bot");
  assert.equal(renamed.credentialRef, before?.credentialRef);
  assert.equal(renamed.state, "online");
  assert.equal(supervisorStarts, 0);
  const restored = host.setBotAlias({ botId: bot.botId, alias: "" });
  assert.equal(restored.displayName, "Night Bot");
  assert.equal(TYPERT_REMOTE.descriptors.some((row) => row.method === "setBotAlias"), true);
  rt.store.close();
});

test("legacy bot rows without alias columns still list after preservation migration", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE im_v2_bots (
    bot_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, display_name TEXT NOT NULL,
    credential_ref TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  db.prepare(
    "INSERT INTO im_v2_bots(bot_id, channel_id, display_name, credential_ref, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  ).run("legacy", "slack", "Old Name", "PENGLAI_SLACK_BOT", "online", 1, 1);
  const bots = new ImBotStore(db);
  const row = bots.list("slack")[0];
  assert.equal(row?.displayName, "Old Name");
  assert.equal(row?.originalDisplayName, "Old Name");
  assert.equal(bots.setAlias("legacy", "Alias").originalDisplayName, "Old Name");
  db.close();
});

test("invalid alias is rejected as INVALID_INPUT", () => {
  const db = new DatabaseSync(":memory:");
  const bots = new ImBotStore(db);
  const created = bots.create({ channelId: "discord", displayName: "Bot" });
  assert.throws(() => bots.setAlias(created.botId, "bad\nalias"), (error: unknown) => {
    assert.ok(error instanceof PenglaiError);
    assert.equal(error.errorClass, "INVALID_INPUT");
    return true;
  });
  db.close();
});
