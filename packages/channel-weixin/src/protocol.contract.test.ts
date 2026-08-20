import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_REDIRECT_HOSTS,
  QR_TTL_MS,
  STATUS_POLL_TIMEOUT_MS,
  assertRedirectBase,
  mapQrStatus,
  randomWechatUin,
} from "./protocol.js";
import { ILinkClient } from "./ilink.js";

test("R2I-WX-003 official QR status enum is closed", () => {
  for (const status of [
    "wait",
    "scaned",
    "confirmed",
    "expired",
    "scaned_but_redirect",
    "need_verifycode",
    "verify_code_blocked",
    "binded_redirect",
  ]) {
    assert.equal(mapQrStatus(status), status);
  }
  assert.equal(mapQrStatus("unexpected"), "error");
});

test("R2I-WX-002 QR TTL is 5 minutes and status poll timeout is 35s", () => {
  assert.equal(QR_TTL_MS, 300_000);
  assert.equal(STATUS_POLL_TIMEOUT_MS, 35_000);
});

test("R2I-WX-006 X-WECHAT-UIN is base64 of a random uint32 and not constant 0", () => {
  const a = randomWechatUin(() => Uint8Array.from([1, 2, 3, 4]));
  const b = randomWechatUin(() => Uint8Array.from([5, 6, 7, 8]));
  assert.notEqual(a, b);
  assert.notEqual(a, Buffer.alloc(4).toString("base64"));
  const live = new Set(Array.from({ length: 8 }, () => randomWechatUin()));
  assert.ok(live.size > 1);
});

test("R2I-WX-005 redirect base must be https allowlisted and is applied", async () => {
  assert.equal(assertRedirectBase("https://ilinkai.weixin.qq.com/v2"), "https://ilinkai.weixin.qq.com");
  assert.throws(() => assertRedirectBase("http://ilinkai.weixin.qq.com"));
  assert.throws(() => assertRedirectBase("https://evil.example"));
  assert.deepEqual(ALLOWED_REDIRECT_HOSTS, ["ilinkai.weixin.qq.com"]);
  const seen: string[] = [];
  const client = new ILinkClient(async (url) => {
    seen.push(url);
    if (url.includes("get_bot_qrcode")) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ qrcode: "q", qrcode_img_content: "https://liteapp.weixin.qq.com/q/fixture" }); } };
    }
    if (url.includes("get_qrcode_status")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ status: "scaned_but_redirect", baseurl: "https://ilinkai.weixin.qq.com" });
        },
      };
    }
    return { ok: true, status: 200, async text() { return JSON.stringify({}); } };
  });
  await client.getQr();
  await client.pollQr("q");
  const next = await client.getUpdates("tok", "");
  void next;
  assert.ok(seen.some((u) => u.startsWith("https://ilinkai.weixin.qq.com/")));
});

test("R2I-WX-006 ILinkClient sends a non-constant X-WECHAT-UIN per request", async () => {
  const uins: string[] = [];
  const client = new ILinkClient(async (_url, init) => {
    uins.push(init.headers["X-WECHAT-UIN"] ?? "");
    return { ok: true, status: 200, async text() { return JSON.stringify({ qrcode: "q", qrcode_img_content: "https://liteapp.weixin.qq.com/q/fixture" }); } };
  });
  await client.getQr();
  await client.getQr();
  assert.equal(uins.length, 2);
  assert.ok(uins.every((u) => u.length > 0 && u !== "0"));
  assert.notEqual(uins[0], uins[1]);
});
