import assert from "node:assert/strict";
import test from "node:test";
import { allowMicrophoneMedia, issueMicrophoneNonce, MICROPHONE_NONCE_TTL_MS } from "./microphone-grant.js";

test("R56-VOICE microphone nonce is loopback audio-only and expires", () => {
  assert.throws(() => issueMicrophoneNonce({ webContentsId: 1, origin: "https://example.com/" }), /origin/);
  const pending = issueMicrophoneNonce({
    webContentsId: 7,
    origin: "http://127.0.0.1:9/",
    now: 1_000,
  });
  assert.equal(
    allowMicrophoneMedia({
      pending,
      webContentsId: 7,
      details: { requestingUrl: "http://127.0.0.1:9/", mediaTypes: ["audio"] },
      now: 1_100,
    }).allow,
    true,
  );
  assert.equal(
    allowMicrophoneMedia({
      pending,
      webContentsId: 7,
      details: { requestingUrl: "http://127.0.0.1:9/", mediaTypes: ["audio", "video"] },
      now: 1_100,
    }).allow,
    false,
  );
  assert.equal(
    allowMicrophoneMedia({
      pending,
      webContentsId: 7,
      details: { requestingUrl: "http://127.0.0.1:9/", mediaTypes: ["video"] },
      now: 1_100,
    }).allow,
    false,
  );
  assert.equal(
    allowMicrophoneMedia({
      pending,
      webContentsId: 7,
      details: { requestingUrl: "http://127.0.0.1:9/" },
      now: 1_100,
    }).allow,
    false,
  );
  assert.equal(
    allowMicrophoneMedia({
      pending,
      webContentsId: 8,
      details: { requestingUrl: "http://127.0.0.1:9/", mediaTypes: ["audio"] },
      now: 1_100,
    }).allow,
    false,
  );
  assert.equal(
    allowMicrophoneMedia({
      pending,
      webContentsId: 7,
      details: { requestingUrl: "http://127.0.0.1:9/", mediaTypes: ["audio"] },
      now: 1_000 + MICROPHONE_NONCE_TTL_MS + 1,
    }).allow,
    false,
  );
});
