import assert from "node:assert/strict";
import test from "node:test";
import { assertCatalogComplete, assertHonestTrustCopy, assertSafeListenHost, backoffMs, classifyTransportError, PenglaiError, PENGLAI_I18N, redactEvidenceText, splitFragments, t, utf8Bytes } from "./index.js";

test("refuses non-loopback listen hosts", () => {
  assert.throws(() => assertSafeListenHost("0.0.0.0"), PenglaiError);
  assert.throws(() => assertSafeListenHost("::"), PenglaiError);
  assertSafeListenHost("127.0.0.1");
});

test("R2-WEB-006 exact origin and host reject prefix confusion", async () => {
  const { exactOriginAllowed, exactHostAllowed } = await import("./index.js");
  assert.equal(exactOriginAllowed("http://127.0.0.1:9", "http://127.0.0.1:9"), true);
  assert.equal(exactOriginAllowed("http://127.0.0.1.evil.example", "http://127.0.0.1:9"), false);
  assert.equal(exactOriginAllowed("http://127.0.0.1:90", "http://127.0.0.1:9"), false);
  assert.equal(exactHostAllowed("127.0.0.1:9", "127.0.0.1", 9), true);
  assert.equal(exactHostAllowed("127.0.0.1.evil.example", "127.0.0.1", 9), false);
});

test("fragmentation is deterministic and ordered", () => {
  const parts = splitFragments("abcdefghij", 3);
  assert.deepEqual(parts, ["abc", "def", "ghi", "j"]);
});

test("utf8 size counts bytes", () => {
  assert.equal(utf8Bytes("你"), 3);
});

test("R50-UI-002/003 Penglai catalog has complete zh and en", () => {
  assertCatalogComplete();
  assert.equal(t("zh", "centerTitle"), "蓬莱插件中心");
  assert.equal(t("en", "centerTitle"), "Penglai Plugin Center");
  assert.equal(t("zh", "asrTitle"), "蓬莱语音识别");
  assert.equal(t("zh", "imTitle"), "蓬莱手机消息");
  assert.equal(t("en", "ttsTitle"), "Penglai Voice Generation");
  assert.equal(Object.keys(PENGLAI_I18N.zh).length, Object.keys(PENGLAI_I18N.en).length);
});

test("R50-UI-008 about/trust copy does not claim notarized or silent update", () => {
  assertHonestTrustCopy(PENGLAI_I18N.zh.aboutTrust);
  assertHonestTrustCopy(PENGLAI_I18N.en.aboutTrust);
  assert.throws(() => assertHonestTrustCopy("This build is notarized and offers silent auto-update"));
});

test("transport errors classify and auth does not retry", () => {
  assert.equal(classifyTransportError({ status: 401, message: "revoked" }), "auth");
  assert.equal(classifyTransportError({ status: 429 }), "rate");
  assert.equal(classifyTransportError(new Error("ENOTFOUND host")), "network");
  assert.equal(classifyTransportError({ status: 503 }), "server");
  assert.equal(backoffMs(0, "auth"), Number.POSITIVE_INFINITY);
  const low = backoffMs(1, "rate", 0);
  const high = backoffMs(1, "rate", 1);
  assert.ok(low < high);
  assert.ok(high <= 60_000);
});

test("evidence redaction covers key url base64 and unicode shreds", () => {
  const beginPrivateKey = ["-----BEGIN", " PRIVATE KEY-----"].join("");
  const endPrivateKey = ["-----END", " PRIVATE KEY-----"].join("");
  const secretKey = ["sk", "abcdefghijklmnop"].join("-");
  const raw =
    `${beginPrivateKey}\nprivate-material\n${endPrivateKey} ` +
    `${secretKey} https://evil.example/x ` +
    "A".repeat(48) +
    "\u200Bsecret";
  const out = redactEvidenceText(raw);
  assert.equal(out.includes("private-material"), false);
  assert.equal(out.includes(secretKey), false);
  assert.equal(out.includes("https://evil.example"), false);
  assert.equal(out.includes("\u200B"), false);
});
