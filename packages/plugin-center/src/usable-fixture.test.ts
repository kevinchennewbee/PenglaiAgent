import assert from "node:assert/strict";
import test from "node:test";
import { runOfficialUsableFixture } from "./usable-fixture.js";

test("usable fixture refuses missing official services", async () => {
  delete process.env.PENGLAI_FIXTURE_URL;
  await assert.rejects(() => runOfficialUsableFixture({}), /PENGLAI_FIXTURE_URL/);
});

test("usable fixture uses official credentials/settings/workspace/agents", async () => {
  process.env.PENGLAI_FIXTURE_URL = "http://127.0.0.1:9/v1";
  process.env.PENGLAI_USER_DATA = "/tmp/penglai-usable-test";
  const result = await runOfficialUsableFixture({
    credentials: {
      async set() {},
      async describe() {
        return { configured: true };
      },
    },
    settings: {
      async mutate() {},
      describe() {
        return [];
      },
    },
    workspaceRegistry: {
      async create() {
        return { id: "ws1", title: "Penglai Fixture" };
      },
      list() {
        return [{ id: "ws1", title: "Penglai Fixture" }];
      },
    },
    agents: {
      async create() {
        return {
          agent: { followup() {} },
          async dispose() {},
        };
      },
      async resume() {
        return {
          agent: { followup() {} },
          async dispose() {},
        };
      },
    },
    on(_ev, fn) {
      fn(
        { id: "s1" },
        { type: "assistant/message", data: { turn: 1, message: { content: [{ type: "text", text: "penglai-usable-ok" }] } } },
      );
      fn({ id: "s1" }, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
    },
  });
  assert.equal(result.byok.configured, true);
  assert.equal(result.workspace.id, "ws1");
  assert.match(result.conversation.reply, /penglai-usable-ok/);
  assert.equal(result.conversation.recovered, true);
});
