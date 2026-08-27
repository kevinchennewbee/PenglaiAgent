import assert from "node:assert/strict";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import { classifyMessageFailure, publicMessageFailure } from "./message-failure.js";

test("message failure maps auth and rate limits to stable codes with a reference id", () => {
  const auth = classifyMessageFailure(new PenglaiError("AUTH_EXPIRED", "SLACK_TOKEN_INVALID"));
  assert.equal(auth.code, "CHANNEL_AUTH");
  assert.match(auth.referenceId, /^MF-[A-Z0-9]{8}$/);
  const rate = classifyMessageFailure(new Error("429 RATE_LIMIT"));
  assert.equal(rate.code, "CHANNEL_RATE_LIMIT");
  const pub = publicMessageFailure(auth);
  assert.equal(JSON.stringify(pub).includes("stack"), false);
});
