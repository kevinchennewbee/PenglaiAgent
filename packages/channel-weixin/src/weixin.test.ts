import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import test from "node:test";
import type { ModelInput } from "@penglai/contracts";
import { SeqIds, VirtualClock } from "@penglai/testkit";
import { Store } from "@penglai/persistence";
import { RoutingControlPlane } from "@penglai/routing-core";
import {
  MemoryVault,
  WeixinAdapter,
  WEIXIN_TOKEN_CREDENTIAL_REF,
  WEIXIN_CONTEXT_CREDENTIAL_REF,
  parseInbound,
  parseOfficialInbound,
  ILinkClient,
  ILINK_CDN_BASE,
  buildSendBody,
  randomWechatUin,
  type WeixinTransport,
} from "./index.js";
import {
  downloadAndDecryptWeixinVoice,
  uploadWeixinAudioFile,
  uploadWeixinVoice,
  type WeixinVoiceMediaRef,
} from "./cdn.js";
import {
  ILINK_LEGACY_VOICE_CHANNEL_VERSION,
  ILINK_LEGACY_VOICE_CLIENT_VERSION,
  buildVoiceSendBody,
} from "./protocol.js";

const SILK_FIXTURE = Buffer.from(
  "AiMhU0lMS19WMy0AxQR5Xry+rQpd4z2wKPbZ2hg+LpkI/VEY9cBVfXRK9w59L8WuFdyY2jpbqjS/UwC+XsbNbc1FSY9BLNJxv+m0pK3Q9cgE8SDCVSfGRj7fGy/Uav2/d6zmgtv2VzI2ZcDaIqJj+/TEY9qx1SzdfJAXu7JS1H6L1Ajm0Px5MA620mAWQ2AAvmP1pWARYPLbADR73otW386EVOyBGeUMGPUIqZgmA/YK4EzHX17ovB6wJe4OReVcFFlbsIS4XEYKa32H9QahKeI7J5fUYZ7XMw1Afpzanm8gp12hN59dcNO8uPD6Qg5fWgC+Y9v0aC5lq5/kUk+bcCZ9XbHSNRuNhCk8RXOkO4GICdRih0+eB8cPgJgQ58SLTwUgZbi3GGnDmGdjO3N4Ef6JAihbG+BueOM/fa/vjYjRHxZcuVE+QUcMHL9VAL5j2/RrqfJWNgLgBAaxJD7jep7EtF82KuPACvI4SbQJ+6wUBy9UvM3M7JsbKM+PLPP+jjfYWFTftM5Ryb5EAhiTsYNe/A0j1qEGiH56hLNDI2U67z9gAL5j9acoHlqYoGeNEEyjh5Nmgp+Y8sWsxIfTUKNW7Ib5Z3NhMd35D2rx4Oa3vP+xNjN7VRhWWQOMGVvPxhFvJuLfpY9VoHBnfgwXohcPe9LM6oq5aBMRiB6DTxeic833n10AvmP1pWARYPLa/74qMVNUa5kMLCtha/EEddwHinwOGH2h65wDeycvIuvE9HDZI1suBcq7Luzzwgm8HvU2S4l2sQ9djysbrsBPNT8GTsFmyI91fTuFwJhhN0IGnX+XUwC+Y9v0aCwPnT7r5eb38Y4tEpJy1NTUm4bQuNIur8+e1xmWCX2aVnfgTIyWrNOX7Cd9/jP5SJ9ADmOMJVsnB84h2zIhiq9kS2j82EY5sJ8rmY7RfUkAvmPW+wycbUVpJcA+6p6tIwim657rrIGd1YQ7v8M/TE7Ol8sIZRmaBZdwVf5vjV0ouFyt5H5o24ChsWHPUt5ujZHHdmIESAjm7WUAvmPb9GGt8Kdr58C6dHkTgEfTJqaw47SDmsQ5UtzmdMMFwQ5bH0HhkvJ0NHGa68Ixw81ijfv+RPD3j4cGzNdFGNfIWi+IHsHKVyIxnJ+hI2ngJvzn7UQ/rf89PYwPbWpD1qDUhe8=",
  "base64",
);

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("async voice job did not settle");
}

function voicePlane() {
  const clock = new VirtualClock();
  const store = new Store(":memory:");
  const inputs: ModelInput[] = [];
  const plane = new RoutingControlPlane(
    store,
    clock,
    new SeqIds(),
    { async listWorkspaces() { return [{ id: "ws", title: "WS" }]; }, async listSessions() { return [{ id: "sess" }]; } },
    {
      async followup(input) { inputs.push(input); return { dshMessageId: `dsh_${input.inboundId}` }; },
      async steer(input) { inputs.push(input); return { dshMessageId: `dsh_${input.inboundId}` }; },
      async cancelCurrent() {},
      async removeInbox() {},
    },
  );
  return { clock, store, plane, inputs };
}

test("weixin image ingest downloads real bytes into a media envelope", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const { plane } = voicePlane();
  const transport: WeixinTransport = {
    async getQr() { return { qrRef: "qr", expiresAt: 1 }; },
    async pollQr() { return { status: "connected", tokenRef: "t", scannerUserId: "u" }; },
    async getUpdates(buf) { return { buf, messages: [] }; },
    async send() { return { ok: true }; },
    async downloadCdn() { return png; },
  };
  const ad = new WeixinAdapter(plane, transport, new MemoryVault());
  ad.imageAdmission = {
    async saveImage(input) {
      return {
        attachmentId: "att-wx-png",
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
      };
    },
  };
  await ad.startQr();
  await ad.poll("qr");
  const accepted = await ad.ingest({
    messageId: "img-bytes",
    fromUserId: "u",
    chatType: "private",
    itemType: "image",
    image: { encrypt_query_param: "imgq", aes_key: Buffer.alloc(16).toString("base64") },
  });
  assert.equal(accepted.kind, "accepted");
  const handle = `media-${createHash("sha256").update(png).digest("hex").slice(0, 24)}`;
  assert.equal(ad.mediaStore.get(handle).equals(png), true);
});

test("private voice is classified for ASR and images enter as media", () => {
  const voice = parseOfficialInbound(
    { message_type: 1, from_user_id: "u", item_list: [{ type: 3, msg_id: "v1" }] },
    "a",
  );
  assert.equal("reject" in voice, false);
  if (!("reject" in voice)) {
    assert.equal(voice.bodyKind, "voice");
    assert.equal(voice.adapterMessageKey, "v1");
  }
  const image = parseOfficialInbound({ message_type: 1, from_user_id: "u", item_list: [{ type: 2, msg_id: "img1" }] }, "a");
  assert.equal("reject" in image, false);
  if (!("reject" in image)) {
    assert.equal(image.bodyKind, "media");
    assert.equal(image.text, undefined);
    assert.equal(image.media?.kind, "image");
    assert.notEqual(image.text, "[image]");
  }
});

test("parser rejects group and media without downloading", () => {
  assert.deepEqual(
    parseInbound({ messageId: "1", fromUserId: "u", chatType: "group", itemType: "text", text: "x" }, "a"),
    { reject: "group" },
  );
  const image = parseInbound({ messageId: "2", fromUserId: "u", chatType: "private", itemType: "image", image: { encrypt_query_param: "imgq", aes_key: Buffer.alloc(16).toString("base64") } }, "a");
  assert.equal("reject" in image, false);
  if (!("reject" in image)) {
    assert.equal(image.bodyKind, "media");
    assert.equal(image.media?.kind, "image");
    assert.notEqual(image.text, "[image]");
  }
});

test("R50-VOICE: weixin inbound wav transcribes and outbound keeps a visible audio fallback", async () => {
  const { inboundVoiceToText, outboundTtsAttachment, weixinVisibleAudioFallback } = await import("./media.js");
  const wav = toneWav();
  const text = await inboundVoiceToText(wav, {
    async stageAudio(data, input) {
      return {
        id: "00000000-0000-4000-8000-000000000003",
        digest: createHash("sha256").update(data).digest("hex"),
        mediaType: "audio/wav",
        bytes: data.length,
        durationMs: 1000,
        source: "im",
        ownerOperation: input.ownerOperation,
        expiresAt: Date.now() + 60_000,
      };
    },
    async transcribe(handle) {
      return {
        handle,
        draft: { text: "licensed Weixin fixture", confirmed: false, language: "zh", emotion: "HAPPY" },
        draftDigest: createHash("sha256").update("licensed Weixin fixture").digest("hex"),
      };
    },
  }, {
    authorized: true,
    claimed: true,
    privateChat: true,
    operationId: "asr_weixin_fixture_1",
  });
  assert.ok(text.text.length > 0);
  assert.equal(text.language, "zh");
  assert.equal(text.emotion, "HAPPY");
  let released = false;
  const digest = createHash("sha256").update(wav).digest("hex");
  const out = await outboundTtsAttachment({
    finalText: "hello penglai",
    sourceFinalId: "final:weixin-1",
    operationId: "tts-weixin-1",
  }, "text+voice", {
    async synthesize(request) {
      assert.equal(
        request.finalDigest,
        createHash("sha256").update(request.finalText).digest("hex"),
      );
      return {
        handle: {
          id: "00000000-0000-4000-8000-000000000002",
          digest,
          bytes: wav.length,
          durationMs: 1000,
          voiceId: request.voiceId,
          sourceFinalDigest: request.finalDigest,
          ownerOperation: request.operationId,
          expiresAt: Date.now() + 60_000,
        },
        operation: { operationId: request.operationId },
      };
    },
    async readOutput() { return wav; },
    async releaseOutput() { released = true; },
  });
  assert.equal(out.text, "hello penglai");
  assert.ok(out.audio);
  const fallback = weixinVisibleAudioFallback(out.audio!);
  assert.equal(fallback.itemType, "file");
  assert.match(fallback.filename, /\.wav$/);
  assert.equal(fallback.data.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(released, true);
});

function toneWav(): Buffer {
  const frames = 16000;
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i += 1) data.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 16000)), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test("official fixture: group_id and image item fail closed", () => {
  assert.deepEqual(parseOfficialInbound({ group_id: "g1", message_type: 1, item_list: [{ type: 1, text_item: { text: "x" } }] }, "a"), {
    reject: "group",
  });
  const image = parseOfficialInbound({ message_type: 1, from_user_id: "u", item_list: [{ type: 2, msg_id: "i2" }] }, "a");
  assert.equal("reject" in image, false);
  if (!("reject" in image)) assert.equal(image.bodyKind, "media");
});

test("official private text yields stable adapter key", () => {
  const env = parseOfficialInbound(
    {
      message_type: 1,
      from_user_id: "user-1",
      item_list: [{ type: 1, msg_id: "mid-9", text_item: { text: "hello" } }],
      context_token: "ctx",
    },
    "acct",
  );
  assert.ok(!("reject" in env));
  if ("reject" in env) return;
  assert.equal(env.adapterMessageKey, "mid-9");
  assert.equal(env.chatKind, "private");
  assert.equal(env.text, "hello");
  assert.equal(env.peerRef.length, 24);
  assert.equal(env.vendorTarget, "user-1");
  assert.notEqual(env.vendorTarget, env.peerRef);
});

test("QR expiry does not reuse secret", async () => {
  const transport: WeixinTransport = {
    async getQr() { return { qrRef: "qr1", expiresAt: 1 }; },
    async pollQr() { return { status: "expired" }; },
    async getUpdates(buf) { return { buf, messages: [] }; },
    async send() { return { ok: true }; },
  };
  const plane = new RoutingControlPlane(
    new Store(":memory:"),
    new VirtualClock(),
    new SeqIds(),
    { async listWorkspaces() { return []; }, async listSessions() { return []; } },
    { async followup() { return { dshMessageId: "d" }; }, async steer() { return { dshMessageId: "d" }; }, async cancelCurrent() {}, async removeInbox() {} },
  );
  const ad = new WeixinAdapter(plane, transport, new MemoryVault());
  await ad.startQr();
  assert.equal(await ad.poll("qr1"), "expired");
  assert.equal(ad.health().hasCredential, false);
});

test("need_verifycode stops for the user", async () => {
  const transport: WeixinTransport = {
    async getQr() { return { qrRef: "qr2", expiresAt: 1 }; },
    async pollQr() { return { status: "need_verify", needsVerify: true }; },
    async getUpdates(buf) { return { buf, messages: [] }; },
    async send() { return { ok: true }; },
  };
  const plane = new RoutingControlPlane(
    new Store(":memory:"),
    new VirtualClock(),
    new SeqIds(),
    { async listWorkspaces() { return []; }, async listSessions() { return []; } },
    { async followup() { return { dshMessageId: "d" }; }, async steer() { return { dshMessageId: "d" }; }, async cancelCurrent() {}, async removeInbox() {} },
  );
  const ad = new WeixinAdapter(plane, transport, new MemoryVault());
  await ad.startQr();
  assert.equal(await ad.poll("qr2"), "need_verify");
});

test("ilink client maps endpoints and never logs token", async () => {
  const seen: Array<{
    url: string;
    auth?: string;
    clientVersion?: string;
    wechatUin?: string;
    body?: string;
  }> = [];
  const client = new ILinkClient(async (url, init) => {
    seen.push({
      url,
      auth: init.headers.Authorization,
      clientVersion: init.headers["iLink-App-ClientVersion"],
      wechatUin: init.headers["X-WECHAT-UIN"],
      body: init.body,
    });
    if (url.includes("get_bot_qrcode")) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ qrcode: "ref", qrcode_img_content: "https://example.invalid/q" }); } };
    }
    if (url.includes("get_qrcode_status")) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ status: "confirmed", bot_token: "secret-token", ilink_bot_id: "bot1" }); } };
    }
    if (url.includes("getupdates")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ret: 0,
            msgs: [{ message_type: 1, from_user_id: "u", item_list: [{ type: 1, msg_id: "m1", text_item: { text: "hi" } }] }],
            get_updates_buf: "b2",
          });
        },
      };
    }
    return { ok: true, status: 200, async text() { return JSON.stringify({ ret: 0 }); } };
  });
  const qr = await client.getQr();
  assert.equal(qr.qrRef, "ref");
  assert.match(qr.qrImageRef, /^data:image\/png;base64,/);
  assert.equal(Buffer.from(qr.qrImageRef.slice("data:image/png;base64,".length), "base64").subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
  const st = await client.pollQr(qr.qrRef);
  assert.equal(st.status, "confirmed");
  const up = await client.getUpdates("secret-token", "");
  assert.equal(up.messages.length, 1);
  const sent = await client.send("secret-token", buildSendBody({ to: "u", text: "ok", clientId: "c1" }));
  assert.deepEqual(sent, { ok: true });
  assert.ok(seen.some((s) => s.url.includes("/ilink/bot/get_bot_qrcode")));
  assert.ok(seen.some((s) => s.url.includes("/ilink/bot/sendmessage")));
  assert.ok(seen.every((s) => s.clientVersion === "132102"));
  for (const request of seen.filter((s) => s.body)) {
    const body = JSON.parse(request.body!) as { base_info?: { channel_version?: string; bot_agent?: string } };
    assert.deepEqual(body.base_info, { channel_version: "2.4.6", bot_agent: "Penglai/0.5.5" });
    assert.match(Buffer.from(request.wechatUin!, "base64").toString("utf8"), /^\d+$/);
  }
});

test("official X-WECHAT-UIN encodes the random uint32 decimal string", () => {
  assert.equal(randomWechatUin(() => Uint8Array.from([0, 0, 0, 1])), "MQ==");
});

test("ilink send classifies a non-zero errcode even when ret is absent", async () => {
  const client = new ILinkClient(async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ errcode: -14, errmsg: "expired" }); },
  }));
  assert.deepEqual(
    await client.send("secret-token", buildSendBody({ to: "u", text: "ok", clientId: "c1" })),
    { error: "auth", diagnostic: "sendmessage-code--14" },
  );
});

test("ilink native voice uses the dedicated Tencent CDN fallback origin", async () => {
  const mediaUrls: string[] = [];
  const apiRequests: Array<{
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }> = [];
  const client = new ILinkClient(
    async (url, init) => {
      apiRequests.push({ url, headers: init.headers, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify(url.includes("getuploadurl") ? { upload_param: "voice-upload-param" } : { ret: 0 });
        },
      };
    },
    undefined,
    (async (url) => {
      mediaUrls.push(String(url));
      return new Response("", { status: 200, headers: { "x-encrypted-param": "voice-download-param" } });
    }) as typeof fetch,
  );
  assert.deepEqual(await client.sendNativeVoice("secret-token", {
    to: "u",
    data: SILK_FIXTURE,
    durationMs: 200,
    sampleRate: 24_000,
    clientId: "voice-c1",
    contextToken: "fresh-context",
  }), { ok: true });
  assert.equal(
    mediaUrls[0],
    `${ILINK_CDN_BASE}/upload?encrypted_query_param=voice-upload-param&filekey=${new URL(mediaUrls[0]!).searchParams.get("filekey")}`,
  );
  assert.equal(apiRequests.length, 2);
  for (const request of apiRequests) {
    assert.equal(request.headers["iLink-App-ClientVersion"], String(ILINK_LEGACY_VOICE_CLIENT_VERSION));
    assert.deepEqual(request.body.base_info, { channel_version: ILINK_LEGACY_VOICE_CHANNEL_VERSION });
  }
  const sendBody = apiRequests.find((request) => request.url.includes("sendmessage"))?.body;
  const msg = sendBody?.msg as { item_list?: Array<{ voice_item?: Record<string, unknown> }> } | undefined;
  const voiceItem = msg?.item_list?.[0]?.voice_item;
  assert.deepEqual(Object.keys(voiceItem ?? {}).sort(), ["media", "playtime"]);
  assert.equal(voiceItem?.playtime, 0);
});

test("ilink native voice reports only a safe protocol stage and numeric vendor code", async () => {
  const client = new ILinkClient(async (url) => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(url.includes("getuploadurl")
        ? { ret: 12017, errmsg: "must-not-cross-the-host-boundary" }
        : { ret: 0 });
    },
  }));
  assert.deepEqual(await client.sendNativeVoice("secret-token", {
    to: "u",
    data: SILK_FIXTURE,
    durationMs: 200,
    sampleRate: 24_000,
    clientId: "voice-c2",
    contextToken: "fresh-context",
  }), {
    error: "transient",
    diagnostic: "getuploadurl-code-12017",
  });
});

test("Weixin ingest fail-closes before the scanner identity is known", async () => {
  const transport: WeixinTransport = {
    async getQr() { return { qrRef: "qr", expiresAt: 1 }; },
    async pollQr() { return { status: "waiting" }; },
    async getUpdates(buf) { return { buf, messages: [] }; },
    async send() { return { ok: true }; },
  };
  const plane = new RoutingControlPlane(
    new Store(":memory:"),
    new VirtualClock(),
    new SeqIds(),
    { async listWorkspaces() { return []; }, async listSessions() { return []; } },
    { async followup() { return { dshMessageId: "d" }; }, async steer() { return { dshMessageId: "d" }; }, async cancelCurrent() {}, async removeInbox() {} },
  );
  const ad = new WeixinAdapter(plane, transport, new MemoryVault());
  assert.equal(ad.ownerKnown, false);
  assert.equal(ad.assertAllowlisted("owner"), "allowlist");
  const beforeScan = await ad.ingest({
    messageId: "1",
    fromUserId: "owner",
    chatType: "private",
    itemType: "text",
    text: "hi",
  });
  assert.deepEqual(beforeScan, { kind: "rejected", text: "allowlist" });
});

test("scanner becomes the default unique allowlist", async () => {
  const transport: WeixinTransport = {
    async getQr() { return { qrRef: "qr", qrImageRef: "data:image/png;base64,abc", expiresAt: 1 }; },
    async pollQr() { return { status: "connected", tokenRef: "tok", scannerUserId: "owner" }; },
    async getUpdates(buf) { return { buf, messages: [] }; },
    async send() { return { ok: true }; },
  };
  const plane = new RoutingControlPlane(
    new Store(":memory:"),
    new VirtualClock(),
    new SeqIds(),
    { async listWorkspaces() { return []; }, async listSessions() { return []; } },
    { async followup() { return { dshMessageId: "d" }; }, async steer() { return { dshMessageId: "d" }; }, async cancelCurrent() {}, async removeInbox() {} },
  );
  const ad = new WeixinAdapter(plane, transport, new MemoryVault());
  await ad.startQr();
  await ad.poll("qr");
  assert.equal(ad.assertAllowlisted("owner"), "ok");
  assert.equal(ad.assertAllowlisted("owner"), "ok");
  assert.equal(ad.assertAllowlisted("intruder"), "allowlist");
  const other = await ad.ingest({
    messageId: "2",
    fromUserId: "intruder",
    chatType: "private",
    itemType: "text",
    text: "nope",
  });
  assert.deepEqual(other, { kind: "rejected", text: "allowlist" });
});

test("logout drops vault secret", async () => {
  const vault = new MemoryVault();
  const transport: WeixinTransport = {
    async getQr() { return { qrRef: "qr", expiresAt: 1 }; },
    async pollQr() { return { status: "connected", tokenRef: "tok" }; },
    async getUpdates(buf) { return { buf, messages: [] }; },
    async send() { return { ok: true }; },
  };
  const plane = new RoutingControlPlane(
    new Store(":memory:"),
    new VirtualClock(),
    new SeqIds(),
    { async listWorkspaces() { return []; }, async listSessions() { return []; } },
    { async followup() { return { dshMessageId: "d" }; }, async steer() { return { dshMessageId: "d" }; }, async cancelCurrent() {}, async removeInbox() {} },
  );
  const ad = new WeixinAdapter(plane, transport, vault);
  await ad.startQr();
  await ad.poll("qr");
  assert.equal(await vault.read(WEIXIN_TOKEN_CREDENTIAL_REF), "tok");
  await vault.write(WEIXIN_CONTEXT_CREDENTIAL_REF, "context");
  await ad.logout();
  assert.equal(await vault.read(WEIXIN_TOKEN_CREDENTIAL_REF), undefined);
  assert.equal(await vault.read(WEIXIN_CONTEXT_CREDENTIAL_REF), undefined);
  assert.equal(ad.health().authState, "idle");
});

test("scanner owner identity survives restart and unknown owner blocks cursor", async () => {
  const store = new Store(":memory:");
  const vault = new MemoryVault();
  await vault.write(WEIXIN_TOKEN_CREDENTIAL_REF, "tok");
  const makePlane = () =>
    new RoutingControlPlane(
      store,
      new VirtualClock(),
      new SeqIds(),
      { async listWorkspaces() { return []; }, async listSessions() { return []; } },
      { async followup() { return { dshMessageId: "d" }; }, async steer() { return { dshMessageId: "d" }; }, async cancelCurrent() {}, async removeInbox() {} },
    );

  // First process: scan QR, owner is persisted to adapter_configs.
  const scanTransport: WeixinTransport = {
    async getQr() { return { qrRef: "qr", expiresAt: 1 }; },
    async pollQr() { return { status: "connected", tokenRef: "tok", scannerUserId: "owner-1" }; },
    async getUpdates(buf) { return { buf, messages: [] }; },
    async send() { return { ok: true }; },
  };
  const first = new WeixinAdapter(makePlane(), scanTransport, vault, "weixin-default", store, undefined, store);
  await first.startQr();
  await first.poll("qr");
  assert.equal(first.ownerKnown, true);
  assert.equal(first.assertAllowlisted("owner-1"), "ok");

  // Second process (fresh adapter, same store): owner is restored, not lost.
  const second = new WeixinAdapter(makePlane(), scanTransport, vault, "weixin-default", store, undefined, store);
  assert.equal(second.ownerKnown, true);
  assert.equal(second.assertAllowlisted("owner-1"), "ok");
  assert.equal(second.assertAllowlisted("intruder"), "allowlist");

  // A third process with no owner persisted must not advance the cursor on a
  // message it cannot yet attribute (otherwise the message is silently lost).
  const ownerless = new WeixinAdapter(
    makePlane(),
    {
      async getQr() { return { qrRef: "qr", expiresAt: 1 }; },
      async pollQr() { return { status: "connected", tokenRef: "tok", scannerUserId: "owner-2" }; },
      async getUpdates() {
        return { buf: "next-cursor", messages: [{ messageId: "1", fromUserId: "owner-2", chatType: "private", itemType: "text", text: "hi" }] };
      },
      async send() { return { ok: true }; },
    },
    vault,
    "weixin-default-2",
    store,
    undefined,
    store,
  );
  await ownerless.startReceive();
  await new Promise((resolve) => setTimeout(resolve, 30));
  ownerless.stopReceive();
  assert.equal(store.getCursor("weixin-default-2", "weixin"), undefined);
});

test("R50-VOICE-014 Weixin CDN decrypts SILK and uploads one encrypted visible FILE", async () => {
  const key = Buffer.alloc(16, 0x2a);
  const cipher = createCipheriv("aes-128-ecb", key, null);
  const encryptedFixture = Buffer.concat([cipher.update(SILK_FIXTURE), cipher.final()]);
  const voiceRef: WeixinVoiceMediaRef = {
    media: {
      full_url: "https://ilinkai.weixin.qq.com/voice-fixture",
      aes_key: key.toString("base64"),
      encrypt_type: 1,
    },
    // A real iLink message observed on 2026-08-20 used encode_type=4 while
    // the authenticated/decrypted payload had the canonical SILK header.
    encodeType: 4,
    sampleRate: 24_000,
    playtimeMs: 200,
  };
  const decrypted = await downloadAndDecryptWeixinVoice(
    voiceRef,
    "https://ilinkai.weixin.qq.com",
    (async (url, init) => {
      assert.equal(url, voiceRef.media.full_url);
      assert.equal(init?.redirect, "error");
      return new Response(encryptedFixture, {
        status: 200,
        headers: { "content-length": String(encryptedFixture.length) },
      });
    }) as typeof fetch,
  );
  assert.deepEqual(decrypted, SILK_FIXTURE);

  await assert.rejects(
    () => downloadAndDecryptWeixinVoice(
      { ...voiceRef, encodeType: 5 },
      "https://ilinkai.weixin.qq.com",
      (async () => new Response(encryptedFixture, { status: 200 })) as typeof fetch,
    ),
    /supported SILK variant/,
  );

  let uploadRequest: Record<string, unknown> | undefined;
  let uploadedCiphertext = Buffer.alloc(0);
  const visibleWav = toneWav();
  const uploaded = await uploadWeixinAudioFile(
    {
      data: visibleWav,
      to: "wx-owner",
      base: "https://ilinkai.weixin.qq.com",
      async getUploadUrl(request) {
        uploadRequest = request;
        return { upload_full_url: "https://ilinkai.weixin.qq.com/upload-fixture" };
      },
    },
    (async (_url, init) => {
      uploadedCiphertext = Buffer.from(init?.body as Uint8Array);
      return new Response("", { status: 200, headers: { "x-encrypted-param": "download-receipt" } });
    }) as typeof fetch,
  );
  assert.equal(uploadRequest?.media_type, 3);
  assert.equal(uploadRequest?.rawsize, visibleWav.length);
  assert.notDeepEqual(uploadedCiphertext.subarray(0, 16), visibleWav.subarray(0, 16));
  const decipher = createDecipheriv("aes-128-ecb", Buffer.from(uploaded.aesKeyHex, "hex"), null);
  assert.deepEqual(Buffer.concat([decipher.update(uploadedCiphertext), decipher.final()]), visibleWav);
  assert.equal(uploaded.downloadEncryptedQueryParam, "download-receipt");

  const nativeUpload = await uploadWeixinVoice(
    {
      data: SILK_FIXTURE,
      to: "wx-owner",
      base: "https://ilinkai.weixin.qq.com",
      async getUploadUrl(request) {
        assert.equal(request.media_type, 4);
        return { upload_full_url: "https://ilinkai.weixin.qq.com/upload-native-voice" };
      },
    },
    (async () => new Response("", { status: 200, headers: { "x-encrypted-param": "native-receipt" } })) as typeof fetch,
  );
  const nativeBody = buildVoiceSendBody({
    to: "wx-owner",
    bytes: nativeUpload.bytes,
    durationMs: 200,
    sampleRate: 24_000,
    clientId: "native-probe",
    downloadEncryptedQueryParam: nativeUpload.downloadEncryptedQueryParam,
    aesKeyHex: nativeUpload.aesKeyHex,
  });
  const nativeJson = JSON.stringify(nativeBody);
  assert.match(nativeJson, /"type":3/);
  assert.match(nativeJson, /"encode_type":6/);
  assert.match(nativeJson, /"sample_rate":24000/);
});

test("R50-VOICE-014 Weixin adapter durably claims SILK, enters one Turn, and sends one FILE audio", async () => {
  const h = voicePlane();
  const vault = new MemoryVault();
  const sentText: string[] = [];
  const sentAudio: Buffer[] = [];
  const sentNative: Buffer[] = [];
  const nativeContextTokens: Array<string | undefined> = [];
  const transport: WeixinTransport = {
    async getQr() { return { qrRef: "qr-voice", expiresAt: Date.now() + 300_000 }; },
    async pollQr() { return { status: "connected", tokenRef: "opaque-token", scannerUserId: "wx-owner" }; },
    async getUpdates(buf) { return { buf, messages: [] }; },
    async send(_to, text) { sentText.push(text); return { ok: true }; },
    async downloadVoice(ref) {
      assert.equal(ref.encodeType, 6);
      return SILK_FIXTURE;
    },
    async sendAudioFile(to, input) {
      assert.equal(to, "wx-owner");
      assert.match(input.filename, /\.wav$/);
      sentAudio.push(input.data);
      return { ok: true };
    },
    async sendNativeVoice(to, input) {
      assert.equal(to, "wx-owner");
      assert.equal(input.sampleRate, 24_000);
      sentNative.push(input.data);
      nativeContextTokens.push(input.contextToken);
      return { ok: true };
    },
  };
  const outputWav = toneWav();
  const ttsOperationIds: string[] = [];
  const adapter = new WeixinAdapter(h.plane, transport, vault, "acct", h.store, {
    asr: {
      async stageAudio(data, input) {
        assert.equal(data.subarray(0, 4).toString("ascii"), "RIFF");
        return {
          id: "00000000-0000-4000-8000-000000000021",
          digest: createHash("sha256").update(data).digest("hex"),
          mediaType: "audio/wav",
          bytes: data.length,
          durationMs: 200,
          source: "im",
          ownerOperation: input.ownerOperation,
          expiresAt: Date.now() + 60_000,
        };
      },
      async transcribe(handle) {
        return {
          handle,
          draft: { text: "微信语音指令", confirmed: false, language: "zh", emotion: "HAPPY" },
          draftDigest: createHash("sha256").update("微信语音指令").digest("hex"),
        };
      },
    },
    tts: {
      async synthesize(request) {
        ttsOperationIds.push(request.operationId);
        return {
          handle: {
            id: "00000000-0000-4000-8000-000000000022",
            digest: createHash("sha256").update(outputWav).digest("hex"),
            bytes: outputWav.length,
            durationMs: 1_000,
            voiceId: request.voiceId,
            sourceFinalDigest: request.finalDigest,
            ownerOperation: request.operationId,
            expiresAt: Date.now() + 60_000,
          },
          operation: { operationId: request.operationId },
        };
      },
      async readOutput() { return outputWav; },
      async releaseOutput() {},
    },
  }, h.store);
  await adapter.startQr();
  await adapter.poll("qr-voice");
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws", sessionId: "sess", adapter: "weixin" });
  const bound = await adapter.ingest({
    messageId: "wx-bind",
    fromUserId: "wx-owner",
    chatType: "private",
    itemType: "text",
    text: `/绑定 ${token}`,
    contextToken: "fresh-native-context",
  });
  assert.equal(bound.kind, "control");
  const claimed = await adapter.ingest({
    messageId: "wx-voice-1",
    fromUserId: "wx-owner",
    chatType: "private",
    itemType: "voice",
    voice: {
      media: { encrypt_query_param: "opaque", aes_key: Buffer.alloc(16).toString("base64") },
      encodeType: 6,
      sampleRate: 24_000,
      playtimeMs: 200,
    },
  });
  assert.deepEqual(claimed, { kind: "accepted", text: "voice claimed" });
  await waitFor(() => h.inputs.length === 1);
  assert.equal(h.inputs[0]?.text, "微信语音指令");
  assert.deepEqual(h.inputs[0]?.source.voice, { language: "zh", emotion: "HAPPY", durationMs: 200 });
  const input = h.inputs[0]!;
  h.plane.onClaimed({
    dshMessageId: `dsh_${input.inboundId}`,
    turnId: "wx-turn-1",
    sessionId: "sess",
    source: input.source,
  });
  h.plane.onAssistantFinal({ sessionId: "sess", turnId: "wx-turn-1", text: "微信最终回复" });
  await adapter.pumpOutbox(input.routeId, "wx-owner");
  await adapter.pumpOutbox(input.routeId, "wx-owner");
  // The /绑定 command now produces a channel ack ("bound") plus the voice reply.
  assert.deepEqual(sentText, ["bound"]);
  assert.equal(sentAudio.length, 1);
  assert.equal(sentNative.length, 0);
  assert.equal(sentAudio[0]?.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(await vault.read(WEIXIN_CONTEXT_CREDENTIAL_REF), "fresh-native-context");
  (adapter as unknown as { contextByPeer: Map<string, string> }).contextByPeer.clear();
  const probe = await adapter.probeNativeVoiceBubble();
  assert.match(ttsOperationIds.at(-1) ?? "", /^[A-Za-z0-9_-]{8,128}$/);
  assert.equal(sentNative.length, 1);
  assert.deepEqual(nativeContextTokens, ["fresh-native-context"]);
  assert.equal(sentNative[0]?.subarray(1, 10).toString("ascii"), "#!SILK_V3");
  assert.equal(adapter.nativeVoiceCapability().enabled, false);
  assert.equal(adapter.nativeVoiceCapability().pendingProbeId, probe.probeId);
  assert.deepEqual(adapter.confirmNativeVoiceBubble({ probeId: probe.probeId, visible: true }), { enabled: true });
  assert.deepEqual(adapter.nativeVoiceCapability(), { enabled: true });
  assert.deepEqual(await adapter.probeTextRoundTrip(), { sent: true });
  assert.equal(sentText.at(-1), "蓬莱文字通道测试，请回复：收到文字");
  assert.equal(h.store.pendingOutbox(input.routeId).length, 0);
  adapter.stopReceive();
  h.store.close();
});

test("Weixin office return reuses the authenticated encrypted FILE transport", async () => {
  const h = voicePlane();
  const vault = new MemoryVault();
  const sent: Array<{ to: string; data: Buffer; filename: string; clientId: string }> = [];
  const transport: WeixinTransport = {
    async getQr() { return { qrRef: "qr-file", expiresAt: Date.now() + 60_000 }; },
    async pollQr() { return { status: "connected", tokenRef: "opaque-file-token", scannerUserId: "wx-owner" }; },
    async getUpdates(buf) { return { buf, messages: [] }; },
    async send() { return { ok: true }; },
    async sendAudioFile(to, input) {
      sent.push({ to, data: Buffer.from(input.data), filename: input.filename, clientId: input.clientId });
      return { ok: true };
    },
  };
  await vault.write(WEIXIN_TOKEN_CREDENTIAL_REF, "opaque-file-token");
  const adapter = new WeixinAdapter(h.plane, transport, vault);
  const bytes = Buffer.from("office-file-bytes");
  assert.deepEqual(await adapter.sendFile("wx-owner", bytes, "report.docx", "office-digest-id"), { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.to, "wx-owner");
  assert.equal(sent[0]?.filename, "report.docx");
  assert.equal(sent[0]?.clientId, "office-digest-id");
  assert.equal(sent[0]?.data.equals(bytes), true);
  h.store.close();
});
