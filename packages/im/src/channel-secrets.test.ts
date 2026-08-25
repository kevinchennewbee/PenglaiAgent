import assert from "node:assert/strict";
import test from "node:test";
import { parseSlackSecret, serializeChannelSecret } from "./channel-secrets.js";

test("Slack secrets require both bot and app tokens", () => {
  assert.throws(() => parseSlackSecret("xoxb-only"), /SLACK_APP_TOKEN_REQUIRED/);
  assert.throws(() => parseSlackSecret(JSON.stringify({ botToken: "xoxb-1" })), /SLACK_APP_TOKEN_REQUIRED/);
  assert.deepEqual(parseSlackSecret("xoxb-bot\nxapp-app"), { botToken: "xoxb-bot", appToken: "xapp-app" });
  assert.equal(
    serializeChannelSecret("slack", "xoxb-bot\nxapp-app"),
    JSON.stringify({ botToken: "xoxb-bot", appToken: "xapp-app" }),
  );
});
