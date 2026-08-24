import assert from "node:assert/strict";
import test from "node:test";
import { FeishuAppRegistration, decorateFeishuQrUrl } from "./registration.js";

test("official Feishu registration encodes the landing URL as a PNG QR", async () => {
  const seen: Array<{ url: string; body: string }> = [];
  const client = new FeishuAppRegistration(async (url, init) => {
    seen.push({ url, body: String(init.body ?? "") });
    if (init.body.includes("action=init")) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ supported_auth_methods: ["client_secret"] }); } };
    }
    if (init.body.includes("action=begin")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            device_code: "dev-1",
            verification_uri_complete: "https://open.feishu.cn/page/launcher?user_code=ABCD-EFGH",
            expires_in: 600,
            interval: 5,
          });
        },
      };
    }
    if (init.body.includes("action=poll")) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ error: "authorization_pending" }); } };
    }
    return { ok: true, status: 200, async text() { return JSON.stringify({}); } };
  });
  const started = await client.begin();
  assert.match(started.qrImageRef, /^data:image\/png;base64,/);
  assert.equal(
    Buffer.from(started.qrImageRef.slice("data:image/png;base64,".length), "base64")
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    true,
  );
  assert.equal(started.status, "wait");
  const pending = await client.poll(started.challengeId);
  assert.equal(pending.status, "wait");
  assert.equal(pending.appSecret, undefined);
  assert.ok(seen.some((row) => row.body.includes("action=begin") && row.body.includes("PersonalAgent")));
  assert.match(decorateFeishuQrUrl("https://open.feishu.cn/page/launcher?user_code=ABCD-EFGH"), /createOnly=true/);
  assert.doesNotMatch(JSON.stringify(started), /client_secret|dev-1/);
});

test("confirmed Feishu registration yields credentials only through takeConfirmed", async () => {
  let polls = 0;
  const client = new FeishuAppRegistration(async (_url, init) => {
    if (String(init.body).includes("action=init")) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ supported_auth_methods: ["client_secret"] }); } };
    }
    if (String(init.body).includes("action=begin")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            device_code: "dev-2",
            verification_uri_complete: "https://open.feishu.cn/page/launcher?user_code=WXYZ-1234",
            expires_in: 600,
            interval: 5,
          });
        },
      };
    }
    polls += 1;
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          client_id: "cli_fixture",
          client_secret: "not-a-real-secret",
          user_info: { open_id: "ou_scanner_owner" },
        });
      },
    };
  });
  const started = await client.begin();
  const polled = await client.poll(started.challengeId);
  assert.equal(polled.status, "confirmed");
  assert.equal(polled.appSecret, undefined);
  const creds = client.takeConfirmed(started.challengeId);
  assert.deepEqual(creds, { appId: "cli_fixture", appSecret: "not-a-real-secret", ownerOpenId: "ou_scanner_owner" });
  assert.equal(client.takeConfirmed(started.challengeId), undefined);
  assert.ok(polls >= 1);
});

test("R56-SEC-005 Feishu registration JSON is bound before parse", async () => {
  const client = new FeishuAppRegistration(async () => ({
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === "content-length" ? String(2 * 1024 * 1024) : null) },
    async text() {
      return "{}";
    },
  }));
  await assert.rejects(() => client.begin(), /BOUNDED_HTTP_DECLARED_LENGTH/);
});
