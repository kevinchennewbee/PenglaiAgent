import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import TypertGatewayService from "@deepseek-ai/dsh-api-gateway";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { remoteErrorOf, remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
import { assertCatalogComplete, assertHonestTrustCopy, assertSafeListenHost, backoffMs, classifyTransportError, isErrorClass, isPenglaiRemoteContext, PenglaiError, PenglaiRemote, PENGLAI_I18N, redactedDiagnosticReference, redactEvidenceText, splitFragments, t, utf8Bytes } from "./index.js";

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

test("diagnostic references are stable, namespaced, and one-way", () => {
  const reference = redactedDiagnosticReference("ASR", "private-operation", "STORE_CORRUPT");
  assert.match(reference, /^ASR-[A-F0-9]{12}$/);
  assert.equal(
    reference,
    redactedDiagnosticReference("ASR", "private-operation", "STORE_CORRUPT"),
  );
  assert.notEqual(
    reference,
    redactedDiagnosticReference("TTS", "private-operation", "STORE_CORRUPT"),
  );
  assert.equal(reference.includes("private-operation"), false);
  assert.equal(isErrorClass("STORE_CORRUPT"), true);
  assert.equal(isErrorClass("PRIVATE_ERROR"), false);
  assert.throws(() => redactedDiagnosticReference("bad", "operation"), PenglaiError);
});

test("R50-UI-002/003 Penglai catalog has complete zh and en", () => {
  assertCatalogComplete();
  assert.equal(t("zh", "centerTitle"), "蓬莱插件中心");
  assert.equal(t("en", "centerTitle"), "Penglai Plugin Center");
  assert.equal(t("zh", "asrTitle"), "蓬莱语音识别");
  assert.equal(t("zh", "imTitle"), "消息连接");
  assert.equal(t("en", "imTitle"), "Messaging");
  assert.equal(t("en", "ttsTitle"), "Penglai Voice Generation");
  assert.equal(Object.keys(PENGLAI_I18N.zh).length, Object.keys(PENGLAI_I18N.en).length);
});

test("R50-UI-008 about/trust copy does not claim notarized or silent update", () => {
  assertHonestTrustCopy(PENGLAI_I18N.zh.aboutTrust);
  assertHonestTrustCopy(PENGLAI_I18N.en.aboutTrust);
  assertHonestTrustCopy(PENGLAI_I18N.zh.pluginSharedProcess);
  assertHonestTrustCopy(PENGLAI_I18N.en.pluginSharedProcess);
  assert.throws(() => assertHonestTrustCopy("This build is notarized and offers silent auto-update"));
  assert.throws(() => assertHonestTrustCopy("Plugins run in an isolated plugin process"));
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

test("alpha.2 Remote boundary preserves Penglai failures as namespaced RemoteError", async () => {
  class RemoteFixture {
    @PenglaiRemote
    reject(): never {
      throw new PenglaiError("INVALID_INPUT", "private local diagnostic");
    }
  }
  const service = new RemoteFixture();
  assert.deepEqual(remoteMethods(service).map((entry) => entry.method), ["reject"]);
  await assert.rejects(
    async () => service.reject(),
    (error: unknown) => {
      const remote = remoteErrorOf(error);
      assert.equal(remote?.code, "penglai/invalid-input");
      assert.deepEqual(remote?.details, {});
      assert.equal(remote?.message.includes("private local diagnostic"), false);
      return true;
    },
  );
});

test("alpha.2 Gateway invocation preserves Penglai RemoteError code and redaction", async () => {
  class GatewayFixture extends TypertRemoteService {
    constructor(ctx: Context) {
      super(ctx, "penglaiGatewayFixture");
    }

    @PenglaiRemote
    reject(): never {
      throw new PenglaiError("SECURITY_POLICY", "private owner and local path detail");
    }
  }

  const ctx = new Context();
  const registry = await ctx.plugin(TypertRegistry);
  const gateway = await ctx.plugin(TypertGatewayService, {});
  new GatewayFixture(ctx);
  try {
    await assert.rejects(
      async () =>
        ctx.typertGateway.invoke({
          namespace: "penglaiGatewayFixture",
          method: "reject",
          args: {},
        }),
      (error: unknown) => {
        const remote = remoteErrorOf(error);
        assert.equal(remote?.code, "penglai/security-policy");
        assert.equal(remote?.message.includes("private owner"), false);
        return true;
      },
    );
  } finally {
    await gateway.dispose();
    await registry.dispose();
  }
});

test("alpha.2 Gateway invocation redacts unexpected host exceptions", async () => {
  class GatewayFixture extends TypertRemoteService {
    constructor(ctx: Context) {
      super(ctx, "penglaiUnexpectedFixture");
    }

    @PenglaiRemote
    reject(): never {
      throw new Error("ENOENT C:\\Users\\owner\\private\\credential.json");
    }
  }

  const ctx = new Context();
  const registry = await ctx.plugin(TypertRegistry);
  const gateway = await ctx.plugin(TypertGatewayService, {});
  new GatewayFixture(ctx);
  try {
    await assert.rejects(
      async () => ctx.typertGateway.invoke({ namespace: "penglaiUnexpectedFixture", method: "reject", args: {} }),
      (error: unknown) => {
        const remote = remoteErrorOf(error);
        assert.equal(remote?.code, "penglai/internal");
        assert.equal(remote?.message.includes("ENOENT"), false);
        assert.equal(remote?.message.includes("owner"), false);
        return true;
      },
    );
  } finally {
    await gateway.dispose();
    await registry.dispose();
  }
});

test("alpha.2 Remote registration accepts a structurally valid foreign Cordis bundle", () => {
  const registrations: Array<{ name: string; service: unknown }> = [];
  const foreignContext = {
    reflect: {
      provide(name: string, service: unknown) {
        registrations.push({ name, service });
      },
    },
  };
  assert.equal(foreignContext instanceof Context, false);
  assert.equal(isPenglaiRemoteContext(foreignContext), true);

  class StructuralRemote extends TypertRemoteService {
    constructor(ctx: Context) {
      super(ctx, "penglaiStructuralFixture");
    }
  }
  const remote = new StructuralRemote(foreignContext as unknown as Context);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0]?.name, "penglaiStructuralFixture");
  assert.equal(registrations[0]?.service, remote);
  assert.equal(isPenglaiRemoteContext({ provide() {} }), false);
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
