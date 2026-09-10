import assert from "node:assert/strict";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import { WeixinIlinkResponseError } from "@penglai/channel-weixin";
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

test("bounded HTTP response failures become a closed public protocol cause", () => {
  const failure = publicMessageFailure(
    classifyMessageFailure(
      new PenglaiError("DELIVERY_TRANSIENT", "BOUNDED_HTTP_MIME"),
    ),
  );
  assert.equal(failure.code, "CHANNEL_PROTOCOL");
  assert.equal(failure.reason, "CHANNEL_PROTOCOL");
  assert.match(failure.referenceId, /^MF-[A-Z0-9]{8}$/);
  assert.equal(JSON.stringify(failure).includes("BOUNDED_HTTP_MIME"), false);
});

test("official isDSHRemoteError and failure.code classify slash-separated preset errors", () => {
  const preset = classifyMessageFailure({
    isDSHRemoteError: true,
    code: "agent-preset/unavailable",
    message: "preset missing",
  });
  assert.equal(preset.code, "PRESET_UNAVAILABLE");
  assert.equal(preset.reason, "agent-preset/unavailable");
  assert.match(preset.message.en, /\/projects/);
  assert.match(preset.message.en, /\/new/);
  assert.match(preset.message.zh, /\/项目/);
  assert.match(preset.message.zh, /\/新建/);
  assert.doesNotMatch(preset.message.en, /presetlist/);
  const hyphen = classifyMessageFailure({
    failure: { code: "agent-preset-unavailable", message: "gone" },
  });
  assert.equal(hyphen.code, "PRESET_UNAVAILABLE");
  const unknownOfficial = classifyMessageFailure({
    isDSHRemoteError: true,
    code: "gateway/internal",
    message: "secret=sk-live-do-not-leak stack=Error: boom",
  });
  assert.equal(unknownOfficial.code, "INTERNAL_UNKNOWN");
  const published = publicMessageFailure(unknownOfficial);
  assert.equal(JSON.stringify(published).includes("sk-live"), false);
  assert.equal(JSON.stringify(published).includes("stack"), false);
  assert.notEqual(unknownOfficial.code, "CHANNEL_DELIVERY");
});

test("official RemoteError on Error.cause is classified as PRESET_UNAVAILABLE", () => {
  const failure = classifyMessageFailure(
    new Error("gateway/internal", {
      cause: {
        isDSHRemoteError: true,
        code: "agent-preset/not-found",
        message: "preset missing",
      },
    }),
  );
  assert.equal(failure.code, "PRESET_UNAVAILABLE");
  assert.equal(failure.reason, "agent-preset/not-found");
  assert.doesNotMatch(JSON.stringify(failure), /preset missing|gateway\/internal/);
});

test("missing-session official codes are not classified here", () => {
  const missing = classifyMessageFailure({
    isDSHRemoteError: true,
    code: "session-not-found",
    message: "gone",
  });
  assert.equal(missing.code, "INTERNAL_UNKNOWN");
  assert.notEqual(missing.code, "PRESET_UNAVAILABLE");
});

test("typed iLink response classes take precedence over error-message parsing", () => {
  const observation = {
    phase: "qr-poll" as const,
    httpStatus: 429,
    contentType: "application/json",
  };
  assert.equal(
    classifyMessageFailure(
      new WeixinIlinkResponseError(
        "rate",
        "DELIVERY_TRANSIENT",
        "ILINK_HTTP_STATUS",
        observation,
      ),
    ).code,
    "CHANNEL_RATE_LIMIT",
  );
  assert.equal(
    classifyMessageFailure(
      new WeixinIlinkResponseError(
        "auth",
        "AUTH_EXPIRED",
        "ILINK_HTTP_AUTH",
        { ...observation, httpStatus: 401 },
      ),
    ).code,
    "CHANNEL_AUTH",
  );
});
