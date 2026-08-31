import assert from "node:assert/strict";
import test from "node:test";
import {
  commandLocale,
  formatNumberedHelp,
  formatProjectMenu,
  formatSessionMenu,
  parseMenuPick,
  pickFromMenu,
} from "./menu.js";
import { parseCommand, versionText } from "./commands.js";

test("project menu numbers every workspace under 未分组", () => {
  const { text, menu } = formatProjectMenu(
    [
      { id: "ws-down", title: "Downloads", sessionIds: ["s1", "s2"] },
      { id: "ws-test", title: "api-test" },
    ],
    "ws-down",
  );
  assert.match(text, /【未分组】/);
  assert.match(text, /1\. Downloads · 2 个会话（当前）/);
  assert.match(text, /2\. api-test/);
  assert.equal(menu.choices.length, 2);
  assert.equal(pickFromMenu(menu, 2)?.workspaceId, "ws-test");
});

test("session menu is numbered for reply", () => {
  const { text, menu } = formatSessionMenu(
    "Downloads",
    [
      { id: "s1", title: "新会话" },
      { id: "s2", title: "最新AI新闻搜索" },
    ],
    "s2",
    "ws-down",
  );
  assert.match(text, /1\. 新会话/);
  assert.match(text, /2\. 最新AI新闻搜索（当前）/);
  assert.equal(pickFromMenu(menu, 1)?.sessionId, "s1");
});

test("session menu never exposes an id as the missing-title fallback", () => {
  const duplicate = "同名会话";
  const { text, menu } = formatSessionMenu(
    "工作区",
    [
      { id: "session-uuid-1", title: duplicate },
      { id: "session-uuid-2", title: duplicate },
      { id: "session-secret-looking-id" },
      { id: "session-unicode", title: "研究 🩷 漢字" },
    ],
    "session-uuid-2",
    "workspace-1",
  );
  assert.match(text, /1\. 同名会话/);
  assert.match(text, /2\. 同名会话（当前）/);
  assert.match(text, /3\. 未命名会话 3/);
  assert.match(text, /4\. 研究 🩷 漢字/);
  assert.doesNotMatch(text, /session-(?:uuid|secret|unicode)/);
  assert.deepEqual(
    menu.choices.map((choice) => choice.sessionId),
    ["session-uuid-1", "session-uuid-2", "session-secret-looking-id", "session-unicode"],
  );

  const english = formatSessionMenu(
    "Workspace",
    [{ id: "opaque-session" }],
    undefined,
    "workspace-1",
    "en",
  );
  assert.match(english.text, /1\. Untitled session 1/);
  assert.doesNotMatch(english.text, /opaque-session/);
});

test("many session choices stay bound to their immutable ids", () => {
  const sessions = Array.from({ length: 150 }, (_, index) => ({
    id: `session-${index + 1}`,
    title: index === 149 ? "第一百五十个会话" : `会话 ${index + 1}`,
  }));
  const { text, menu } = formatSessionMenu(
    "大工作区",
    sessions,
    "session-150",
    "workspace-many",
  );
  assert.equal(menu.choices.length, 150);
  assert.equal(pickFromMenu(menu, 150)?.sessionId, "session-150");
  assert.match(text, /150\. 第一百五十个会话（当前）/);
});

test("plain digits select a menu item", () => {
  assert.equal(parseMenuPick("2"), 2);
  assert.equal(parseMenuPick("2."), 2);
  assert.equal(parseMenuPick("2、"), 2);
  assert.equal(parseMenuPick("你好"), undefined);
});

test("help stays numbered and Penglai-branded", () => {
  const text = formatNumberedHelp(true);
  assert.match(text, /1\. \/帮助/);
  assert.match(text, /2\. \/项目/);
  assert.doesNotMatch(text, /DSH|DeepSeek Harness/i);
  const en = formatNumberedHelp(true, "en");
  assert.match(en, /1\. \/help/);
  assert.match(en, /2\. \/projects/);
  assert.doesNotMatch(en, /\/帮助|\/项目/);
  assert.equal(commandLocale("/projects"), "en");
  assert.equal(commandLocale("/项目"), "zh");
  assert.match(text, /11\. \/版本/);
  assert.match(en, /11\. \/version/);
});

test("/version is a local control command and does not mention a second host", () => {
  assert.deepEqual(parseCommand("/version"), { type: "version" });
  assert.deepEqual(parseCommand("/版本"), { type: "version" });
  const text = versionText();
  assert.match(text, /Penglai 0\.5\.9/);
  assert.match(text, /DSH 0\.1\.2-alpha\.2/);
  assert.match(text, /0a53fb55bea101816fa226bb964ae2bed71c343b/);
  assert.match(text, /DSH-IM reference v3\.0\.5/);
  assert.match(text, /64587b3b6162fa34f1c3ddb335a254d4154c9175/);
  assert.doesNotMatch(text, /ea5176be93cf0a5959397bd15d3ef614811a2a67/);
});

test("English project menu uses Ungrouped and keeps choice ids", () => {
  const { text, menu } = formatProjectMenu(
    [{ id: "ws-down", title: "Downloads", sessionIds: ["s1"] }],
    "ws-down",
    "en",
  );
  assert.match(text, /\[Ungrouped\]/);
  assert.match(text, /1\. Downloads · 1 sessions \(current\)/);
  assert.equal(menu.locale, "en");
  assert.equal(pickFromMenu(menu, 1)?.workspaceId, "ws-down");
});
