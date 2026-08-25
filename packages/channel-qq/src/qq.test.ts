import assert from "node:assert/strict";
import test from "node:test";
import { QqAdapter } from "./index.js";
import { QqQrAuth } from "./qr-auth.js";

test("QQ token path is official bot credentials, not personal login", async () => {
  const adapter = new QqAdapter(
    { resolve: () => ({ appId: "app", clientSecret: "sec" }) },
    () => ({
      connected: true,
      async connect() {},
      async disconnect() {},
      async send() {},
    }),
  );
  const begun = await adapter.beginConnection({ method: "token", credentialRef: "PENGLAI_QQ_BOT" });
  assert.equal(begun.kind, "token");
  assert.equal(begun.live, false);
  await assert.rejects(() => adapter.sendText({ text: "hi" }), /QQ_REPLY_TARGET/);
  await adapter.sendText({ text: "hi", peerRef: "user-1" });
});

test("QQ QR uses injected official connector and never logs QR to console", async () => {
  const stored: Record<string, { appId: string; clientSecret: string }> = {};
  const auth = new QqQrAuth((callbacks, opts) => {
    assert.equal(opts.displayQrCodeToConsole, false);
    assert.equal(opts.source, "penglai-im");
    queueMicrotask(() => callbacks.onSuccess({ appId: "app", clientSecret: "sec" }));
    return { cancel() {} };
  });
  const adapter = new QqAdapter(
    {
      resolve: (ref) => stored[ref],
      put: (ref, creds) => {
        stored[ref] = creds;
      },
    },
    () => ({
      connected: true,
      async connect() {},
      async disconnect() {},
    }),
    auth,
  );
  const begun = await adapter.beginConnection({ method: "qr" });
  assert.equal(begun.kind, "qr");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(stored.PENGLAI_QQ_BOT?.appId, "app");
});
