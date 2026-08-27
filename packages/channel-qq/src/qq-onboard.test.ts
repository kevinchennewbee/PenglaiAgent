import assert from "node:assert/strict";
import test from "node:test";
import { createCipheriv, randomBytes } from "node:crypto";
import { startQqOnboard } from "./qq-onboard.js";

function encryptSecret(secret: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64");
}

test("QQ onboard exposes official QR and decrypts credentials locally", async () => {
  let qr = "";
  let calls = 0;
  let bindKey = "";
  const completed = new Promise<{ appId: string; clientSecret: string; userOpenid?: string }>((resolve, reject) => {
    startQqOnboard(
      {
        onQrReady(url) {
          qr = url;
        },
        onSuccess: resolve,
        onFailure: reject,
      },
      {
        source: "penglai im",
        pollIntervalMs: 1,
        fetchFn: async (_url, init) => {
          calls += 1;
          const body = JSON.parse(String(init?.body ?? "{}")) as { key?: string; task_id?: string };
          if (calls === 1) {
            assert.equal(Buffer.from(body.key ?? "", "base64").length, 32);
            bindKey = body.key ?? "";
            return new Response(JSON.stringify({ retcode: 0, data: { task_id: "task+/1" } }), { status: 200 });
          }
          assert.equal(body.task_id, "task+/1");
          return new Response(
            JSON.stringify({
              retcode: 0,
              data: {
                status: 2,
                bot_appid: "qq-app",
                bot_encrypt_secret: encryptSecret("qq-secret", bindKey),
                user_openid: "owner-openid",
              },
            }),
            { status: 200 },
          );
        },
      },
    );
  });
  const credentials = await completed;
  assert.match(qr, /^https:\/\/q\.qq\.com\/qqbot\/openclaw\/connect\.html\?/);
  const parsed = new URL(qr);
  assert.equal(parsed.searchParams.get("task_id"), "task+/1");
  assert.equal(parsed.searchParams.get("source"), "penglai im");
  assert.deepEqual(credentials, { appId: "qq-app", clientSecret: "qq-secret", userOpenid: "owner-openid" });
});

test("QQ onboard cancellation suppresses late callbacks", async () => {
  let failed = 0;
  const stop = startQqOnboard(
    {
      onQrReady() {},
      onSuccess() {},
      onFailure() {
        failed += 1;
      },
    },
    {
      fetchFn: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    },
  );
  stop();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(failed, 0);
});
