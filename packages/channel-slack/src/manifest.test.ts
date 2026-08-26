import assert from "node:assert/strict";
import test from "node:test";
import { SLACK_BOT_SCOPES, slackManifestRequiresReauth } from "./manifest.js";

test("Slack manifest includes reactions:write and flags older grants", () => {
  assert.equal(SLACK_BOT_SCOPES.includes("reactions:write"), true);
  assert.equal(slackManifestRequiresReauth(["chat:write", "im:history"]), true);
  assert.equal(slackManifestRequiresReauth([...SLACK_BOT_SCOPES]), false);
});
