import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PenglaiError } from "@penglai/contracts";
import {
  IMESSAGE_ACCOUNT_REF,
  IMESSAGE_BOT_REPLY_PREFIX,
  IMessageAdapter,
  MacOSMessagesApi,
  normalizeIMessage,
  normalizeIMessageChatGuid,
} from "./index.js";

function fixtureDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE message (guid TEXT, text TEXT, handle_id INTEGER, date INTEGER,
      is_from_me INTEGER, destination_caller_id TEXT);
    CREATE TABLE chat (guid TEXT, service_name TEXT, style INTEGER,
      chat_identifier TEXT, account_login TEXT, last_addressed_handle TEXT);
    CREATE TABLE chat_message_join (message_id INTEGER, chat_id INTEGER);
    CREATE TABLE handle (id TEXT);
  `);
  const chat = db.prepare("INSERT INTO chat VALUES (?, ?, ?, ?, ?, ?)");
  chat.run("self-email", "iMessage", 45, "owner@example.com", "E:OWNER@example.com", null);
  chat.run("friend", "iMessage", 45, "friend@example.com", "E:owner@example.com", "owner@example.com");
  chat.run("self-phone", "iMessage", 45, "+15550001", "E:owner@example.com", "+15550001");
  chat.run("self-destination", "iMessage", 45, "+15550002", "E:owner@example.com", null);
  chat.run("group", "iMessage", 43, "owner@example.com", "E:owner@example.com", null);
  for (const address of ["owner@example.com", "friend@example.com", "+15550001", "+15550002", "owner@example.com"]) {
    db.prepare("INSERT INTO handle VALUES (?)").run(address);
  }
  const insert = (guid: string, text: string | null, chatId: number, fromMe: number, destination = "owner@example.com") => {
    const { lastInsertRowid } = db.prepare("INSERT INTO message VALUES (?, ?, ?, 0, ?, ?)").run(
      guid,
      text,
      chatId,
      fromMe,
      destination,
    );
    db.prepare("INSERT INTO chat_message_join VALUES (?, ?)").run(lastInsertRowid, chatId);
  };
  insert("owner-input", null, 1, 1);
  insert("self-incoming-copy", "hello AI", 1, 0);
  insert("bot-reply", `${IMESSAGE_BOT_REPLY_PREFIX}hello owner`, 1, 1);
  insert("bot-incoming-copy", `${IMESSAGE_BOT_REPLY_PREFIX}hello owner`, 1, 0);
  insert("outgoing-friend", "private outgoing message", 2, 1);
  insert("incoming-friend", "external input", 2, 0);
  insert("owner-phone", "from phone alias", 3, 1);
  insert("owner-phone-copy", "from phone alias", 3, 0);
  insert("owner-destination", "from destination alias", 4, 1, "+15550002");
  insert("owner-destination-copy", "from destination alias", 4, 0, "+15550002");
  insert("outgoing-group", "group message", 5, 1);
  insert("incoming-group", "group inbound", 5, 0);
  return db;
}

function apiFromDb(db: DatabaseSync, platform: NodeJS.Platform = "darwin") {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  return {
    calls,
    api: new MacOSMessagesApi({
      platform,
      dbPath: "/tmp/penglai-imessage-fixture.db",
      execFileImpl: async (file, args) => {
        calls.push({ file, args });
        if (platform !== "darwin") throw new Error("macOS helper must not run");
        const sql = String(args.at(-1) ?? "");
        return { stdout: JSON.stringify(db.prepare(sql).all()) };
      },
      osascriptImpl: async () => {
        if (platform !== "darwin") throw new Error("osascript must not run");
        return { stdout: "Messages" };
      },
    }),
  };
}

test("normalizes private native Messages rows and ignores bot identities", () => {
  const message = normalizeIMessage(
    {
      rowid: 3,
      guid: "p:1",
      chatGuid: "any;-;+8613800000000",
      serviceName: "iMessage",
      text: "hello",
      sender: "+8613800000000",
      style: 45,
    },
    { botId: IMESSAGE_ACCOUNT_REF },
  );
  assert.equal(message?.chatId, "any;-;+8613800000000");
  assert.equal(message?.text, "hello");
  assert.equal(message?.accountRef, IMESSAGE_ACCOUNT_REF);
  assert.equal(
    normalizeIMessage(
      { guid: "p:2", chatGuid: "c", text: "echo", sender: IMESSAGE_ACCOUNT_REF, style: 45 },
      { botId: IMESSAGE_ACCOUNT_REF },
    ),
    null,
  );
});

test("reads fixture rows after a durable cursor and ignores groups", async () => {
  const db = fixtureDb();
  const { api, calls } = apiFromDb(db);
  const rows = await api.listMessages({ after: 0, limit: 50 });
  const accepted = rows.map((row) => normalizeIMessage(row)).filter(Boolean);
  assert.deepEqual(
    accepted.map((row) => row?.messageId),
    ["self-incoming-copy", "incoming-friend", "owner-phone-copy", "owner-destination-copy"],
  );
  assert.equal(accepted.some((row) => row?.messageId === "incoming-group"), false);
  assert.match(String(calls[0]?.args.at(-1)), /c\.style = 45/);
  assert.match(String(calls[0]?.args.at(-1)), /m\.is_from_me = 0/);
  db.close();
});

test("first-enable cursor is the latest private iMessage row", async () => {
  const db = fixtureDb();
  const { api } = apiFromDb(db);
  const latest = await api.getLatestMessageRowId();
  assert.ok(latest > 0);
  const later = await api.listMessages({ after: latest });
  assert.deepEqual(later, []);
  db.close();
});

test("sends text through injected AppleScript and stamps the durable echo marker", async () => {
  const scripts: string[] = [];
  const api = new MacOSMessagesApi({
    platform: "darwin",
    execFileImpl: async () => ({ stdout: "" }),
    osascriptImpl: async (script) => {
      scripts.push(script);
      return { stdout: "" };
    },
  });
  assert.deepEqual(
    await api.sendText({ chatGuid: "any;-;+8613800000000", address: "+8613800000000", text: "hi" }),
    { sent: true },
  );
  assert.match(scripts[0] ?? "", /buddy "\+8613800000000"/);
  assert.ok(scripts[0]?.includes(`send ${JSON.stringify(`${IMESSAGE_BOT_REPLY_PREFIX}hi`)}`));
});

test("normalization never accepts unmarked outgoing or SMS or group rows", () => {
  const row = { guid: "g", chatGuid: "c", sender: "friend@example.com", text: "hello", isFromMe: 1, style: 45 };
  assert.equal(normalizeIMessage(row), null);
  assert.equal(normalizeIMessage({ ...row, isFromMe: 0 })?.text, "hello");
  assert.equal(normalizeIMessage({ ...row, isFromMe: 0, text: `${IMESSAGE_BOT_REPLY_PREFIX}reply` }), null);
  assert.equal(
    normalizeIMessage({ guid: "p:3", chatGuid: "any;-;10000", serviceName: "SMS", text: "spam", sender: "10000" }),
    null,
  );
  assert.equal(
    normalizeIMessage({ guid: "g2", chatGuid: "group", sender: "a", text: "hi", isFromMe: 0, style: 43 }),
    null,
  );
  assert.throws(() => normalizeIMessageChatGuid(""), /IMESSAGE_CHAT_GUID_REQUIRED/);
});

test("unsupported OS never executes macOS helpers", async () => {
  let execs = 0;
  const api = new MacOSMessagesApi({
    platform: "win32",
    execFileImpl: async () => {
      execs += 1;
      throw new Error("should not run");
    },
    osascriptImpl: async () => {
      execs += 1;
      throw new Error("should not run");
    },
  });
  assert.deepEqual(await api.getPermissions(), {
    platform: "win32",
    database: "unsupported",
    automation: "unsupported",
  });
  await assert.rejects(() => api.listMessages(), /IMESSAGE_UNSUPPORTED_OS/);
  await assert.rejects(() => api.getLatestMessageRowId(), /IMESSAGE_UNSUPPORTED_OS/);
  await assert.rejects(
    () => api.sendText({ chatGuid: "any;-;a", text: "x" }),
    /IMESSAGE_UNSUPPORTED_OS/,
  );
  assert.equal(execs, 0);
});

test("disabled adapter performs zero Messages access and permission-denied is not connected", async () => {
  let execs = 0;
  const adapter = new IMessageAdapter({
    platform: "darwin",
    execFileImpl: async () => {
      execs += 1;
      throw Object.assign(new Error("denied"), { stderr: "authorization denied" });
    },
    osascriptImpl: async () => {
      execs += 1;
      throw Object.assign(new Error("denied"), { stderr: "not authorized -1743" });
    },
  });
  assert.equal(adapter.health().connection, "disabled");
  assert.equal(execs, 0);
  await assert.rejects(() => adapter.beginConnection({ method: "manual-fallback" }), /IMESSAGE_PERMISSION_REQUIRED/);
  assert.equal(adapter.health().connection, "not_configured");
  assert.notEqual(adapter.health().connection, "connected");
  await adapter.disconnect();
  assert.ok(execs > 0);
});

test("Windows adapter stays blocked, never connects, and teardown is safe", async () => {
  let execs = 0;
  const adapter = new IMessageAdapter({
    platform: "win32",
    execFileImpl: async () => {
      execs += 1;
      throw new Error("no");
    },
  });
  assert.equal(adapter.health().connection, "blocked");
  await assert.rejects(() => adapter.beginConnection({ method: "manual-fallback" }), /IMESSAGE_UNSUPPORTED_OS/);
  assert.equal(adapter.health().connection, "blocked");
  await adapter.logout();
  assert.equal(adapter.health().connection, "blocked");
  assert.equal(execs, 0);
});

test("lifecycle binds the explicit macos-messages identity and does not replay history", async () => {
  const db = fixtureDb();
  const inbound: string[] = [];
  const adapter = new IMessageAdapter({
    platform: "darwin",
    dbPath: "/tmp/penglai-imessage-fixture.db",
    execFileImpl: async (_file, args) => ({ stdout: JSON.stringify(db.prepare(String(args.at(-1))).all()) }),
    osascriptImpl: async () => ({ stdout: "Messages" }),
  });
  adapter.onInbound(async (msg) => {
    inbound.push(msg.messageId);
  });
  const begun = await adapter.beginConnection({ method: "manual-fallback" });
  assert.equal(begun.kind, "manual-fallback");
  assert.equal(adapter.accountRef, IMESSAGE_ACCOUNT_REF);
  assert.equal(adapter.health().connection, "connected");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(inbound, []);
  const state = adapter.exportPersistedState();
  assert.equal(typeof state.cursor, "number");
  await adapter.disconnect();
  db.close();
});

test("echo and self-chat copies do not loop after restore", async () => {
  const db = fixtureDb();
  const inbound: string[] = [];
  const adapter = new IMessageAdapter({
    platform: "darwin",
    execFileImpl: async (_file, args) => ({ stdout: JSON.stringify(db.prepare(String(args.at(-1))).all()) }),
    osascriptImpl: async () => ({ stdout: "Messages" }),
  });
  adapter.restorePersistedState({ cursor: 0, seenMessageIds: [] });
  adapter.onInbound(async (msg) => {
    inbound.push(msg.messageId);
  });
  await adapter.beginConnection({ method: "manual-fallback" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(inbound.includes("bot-incoming-copy"), false);
  assert.equal(inbound.includes("incoming-group"), false);
  assert.ok(inbound.includes("incoming-friend"));
  const again = new IMessageAdapter({
    platform: "darwin",
    execFileImpl: async (_file, args) => ({ stdout: JSON.stringify(db.prepare(String(args.at(-1))).all()) }),
    osascriptImpl: async () => ({ stdout: "Messages" }),
  });
  const second: string[] = [];
  again.restorePersistedState(adapter.exportPersistedState());
  again.onInbound(async (msg) => {
    second.push(msg.messageId);
  });
  await again.beginConnection({ method: "manual-fallback" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(second, []);
  await adapter.logout();
  await again.logout();
  db.close();
});

test("exact peer/account/route identity is macos-messages and not a legacy default", async () => {
  const message = normalizeIMessage({
    guid: "p:9",
    chatGuid: "any;-;friend@example.com",
    sender: "friend@example.com",
    text: "hi",
    serviceName: "iMessage",
    style: 45,
  });
  assert.equal(message?.accountRef, IMESSAGE_ACCOUNT_REF);
  assert.notEqual(message?.accountRef, "imessage-default");
  assert.equal(message?.chatType, "private");
});

test("permission-denied codes stay actionable Penglai errors, not connected", () => {
  assert.ok(new PenglaiError("AUTH_EXPIRED", "IMESSAGE_PERMISSION_REQUIRED"));
  assert.notEqual("not_configured", "connected");
});
