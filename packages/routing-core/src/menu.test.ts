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
