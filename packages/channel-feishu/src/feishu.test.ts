import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import type { ModelInput } from "@penglai/contracts";
import { encodeFeishuOggOpus } from "@penglai/audio-codecs";
import { SeqIds, VirtualClock } from "@penglai/testkit";
import { Store } from "@penglai/persistence";
import { RoutingControlPlane } from "@penglai/routing-core";
import {
  FEISHU_ALLOWLIST_NOTICE,
  FeishuAdapter,
  parseFeishuEvent,
  parseOfficialReceive,
} from "./index.js";
import { isForbiddenBaseAuth } from "./official.js";

function plane() {
  return new RoutingControlPlane(
    new Store(":memory:"),
    new VirtualClock(),
    new SeqIds(),
    { async listWorkspaces() { return []; }, async listSessions() { return []; } },
    { async followup() { return { dshMessageId: "d" }; }, async steer() { return { dshMessageId: "d" }; }, async cancelCurrent() {}, async removeInbox() {} },
  );
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("async voice job did not settle");
}

function voicePlane() {
  const clock = new VirtualClock();
  const store = new Store(":memory:");
  const inputs: ModelInput[] = [];
  const routing = new RoutingControlPlane(
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
  return { clock, store, plane: routing, inputs };
}

test("R2I-FS-011 group and media rejected", () => {
  assert.deepEqual(parseFeishuEvent({ chatType: "group", messageId: "1", text: "x" }), { reject: "group" });
  const image = parseFeishuEvent({ chatType: "p2p", messageType: "image", messageId: "2" });
  assert.equal("reject" in image, false);
  if (!("reject" in image)) {
    assert.equal(image.bodyKind, "media");
    assert.notEqual(image.text, "[image]");
  }
  const audio = parseFeishuEvent({ chatType: "p2p", messageType: "audio", messageId: "a1", openId: "o" });
  assert.equal("reject" in audio, false);
  if (!("reject" in audio)) assert.equal(audio.bodyKind, "voice");
});

test("R50-VOICE: feishu inbound wav transcribes and outbound is native audio, not a file card", async () => {
  const { inboundFeishuAudioToText, outboundFeishuNativeAudio } = await import("./media.js");
  const wav = toneWav();
  const text = await inboundFeishuAudioToText(wav, {
    async stageAudio(data, input) {
      return {
        id: "00000000-0000-4000-8000-000000000004",
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
        draft: { text: "licensed Feishu fixture", confirmed: false, language: "zh", emotion: "SAD" },
        draftDigest: createHash("sha256").update("licensed Feishu fixture").digest("hex"),
      };
    },
  }, {
    authorized: true,
    claimed: true,
    privateChat: true,
    operationId: "asr_feishu_fixture_1",
  });
  assert.ok(text.text.length > 0);
  assert.equal(text.language, "zh");
  assert.equal(text.emotion, "SAD");
  let released = false;
  const digest = createHash("sha256").update(wav).digest("hex");
  const audio = await outboundFeishuNativeAudio({
    finalText: "飞书回复",
    sourceFinalId: "final:feishu-1",
    operationId: "tts-feishu-1",
  }, {
    async synthesize(request) {
      assert.equal(
        request.finalDigest,
        createHash("sha256").update(request.finalText).digest("hex"),
      );
      return {
        handle: {
          id: "00000000-0000-4000-8000-000000000001",
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
  assert.equal(audio.msgType, "audio");
  assert.equal(audio.contentType, "audio/ogg; codecs=opus");
  assert.equal(audio.opus.subarray(0, 4).toString("ascii"), "OggS");
  assert.match(audio.filename, /\.opus$/);
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

test("R2I-FS-005 Device Flow is not on the adapter", () => {
  const ad = new FeishuAdapter(plane(), "cli_test");
  assert.equal("beginDeviceFlow" in ad, false);
  assert.equal(typeof ad.startQr, "function");
  assert.equal(isForbiddenBaseAuth("device_flow"), true);
  assert.doesNotMatch(ad.checklist().join(" "), /not zero-config/);
});

test("R2I-FS-007/009 official SDK WS start and 3s enqueue", async () => {
  const started: unknown[] = [];
  class FakeClient {
    constructor(public params: { appId: string; appSecret: string }) {}
    im = { message: { reply: async () => ({}), create: async () => ({}) } };
  }
  class FakeDispatcher {
    handles: Record<string, (data: unknown) => unknown> = {};
    register(handles: Record<string, (data: unknown) => unknown>) {
      this.handles = handles;
      return this;
    }
  }
  class FakeWS {
    closed = false;
    dispatcher: FakeDispatcher | undefined;
    constructor(public params: { appId: string; appSecret: string }) {}
    async start(opts: { eventDispatcher: FakeDispatcher }) {
      started.push(this.params);
      this.dispatcher = opts.eventDispatcher;
    }
    close() {
      this.closed = true;
    }
  }
  const ad = new FeishuAdapter(plane(), "cli_test", {
    Client: FakeClient as never,
    WSClient: FakeWS as never,
    EventDispatcher: FakeDispatcher as never,
  });
  await ad.connect("cli_test", "secret");
  ad.setOwner("ou_1", "explicit");
  assert.equal(ad.status, "connected");
  assert.equal(started.length, 1);
  const event = {
    message: { message_id: "om_1", chat_type: "p2p", message_type: "text", content: JSON.stringify({ text: "hi" }) },
    sender: { sender_id: { open_id: "ou_1" } },
  };
  const first = ad.enqueueReceive(event);
  const dup = ad.enqueueReceive(event);
  assert.deepEqual(first, { accepted: true });
  assert.deepEqual(dup, { accepted: true });
  assert.equal(parseOfficialReceive(event).adapter, "feishu");
});

test("crash after Feishu event dedupe but before durable inbound is recoverable", async () => {
  const h = voicePlane();
  const adapter = new FeishuAdapter(
    h.plane,
    "cli_recover",
    undefined,
    h.store,
    { appId: "cli_recover" },
  );
  adapter.setOwner("ou_recover", "explicit");
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws", sessionId: "sess", adapter: "feishu" });
  adapter.enqueueReceive({
    header: { tenant_key: "tenant-recover", app_id: "cli_recover" },
    event: {
      message: {
        message_id: "bind-recover",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: `/绑定 ${token}` }),
      },
      sender: { sender_id: { open_id: "ou_recover" } },
    },
  });
  await adapter.lastEnqueue;
  assert.equal(h.store.claimDedupe("feishu", "event-after-crash", "tenant-recover", "cli_recover"), true);
  const accepted = adapter.enqueueReceive({
    header: { tenant_key: "tenant-recover", app_id: "cli_recover" },
    event: {
      message: {
        message_id: "event-after-crash",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "recover me" }),
      },
      sender: { sender_id: { open_id: "ou_recover" } },
    },
  });
  assert.deepEqual(accepted, { accepted: true });
  await adapter.lastEnqueue;
  assert.equal(h.inputs.length, 1);
  assert.equal(h.inputs[0]?.text, "recover me");
  h.store.close();
});

test("R2I-FS-016 no zero-config claim without app", () => {
  const ad = new FeishuAdapter(plane());
  assert.equal(ad.setupRequired, true);
});

test("R50-FS-003 doctor classifies credential bot permission event publish tenant network", () => {
  const ad = new FeishuAdapter(plane(), "cli_test");
  const missing = ad.doctor({ hasAppId: false, hasSecret: false });
  assert.equal(missing.find((r) => r.class === "credential")?.ok, false);
  const ok = ad.doctor({
    hasAppId: true,
    hasSecret: true,
    botEnabled: true,
    scopes: ["im:message.p2p_msg:readonly", "im:message:send_as_bot"],
    event: "im.message.receive_v1",
    published: true,
    tenantOk: true,
    networkOk: true,
  });
  assert.ok(ok.every((r) => r.ok));
  assert.deepEqual(
    ok.map((r) => r.class),
    ["credential", "bot", "permission", "event", "publish", "tenant", "network"],
  );
});

test("R50-VOICE-015 Feishu resource reaches one Turn and exact final sends native Opus once", async () => {
  const h = voicePlane();
  const inboundOgg = (await encodeFeishuOggOpus(toneWav())).data;
  const outputWav = toneWav();
  const created: Array<Record<string, unknown>> = [];
  const uploads: Array<Record<string, unknown>> = [];

  class FakeClient {
    im = {
      messageResource: {
        get: async (request: Record<string, unknown>) => {
          assert.deepEqual(request, {
            params: { type: "file" },
            path: { message_id: "om_voice_1", file_key: "file_voice_1" },
          });
          return { getReadableStream: () => Readable.from([inboundOgg]) };
        },
      },
      file: {
        create: async (request: Record<string, unknown>) => {
          uploads.push(request);
          return { file_key: "uploaded_opus_1" };
        },
      },
      message: {
        reply: async () => ({}),
        create: async (request: Record<string, unknown>) => {
          created.push(request);
          return {};
        },
      },
    };
  }
  class FakeDispatcher {
    register() { return this; }
  }
  class FakeWS {
    async start() {}
    close() {}
  }

  const adapter = new FeishuAdapter(
    h.plane,
    "cli_voice",
    {
      Client: FakeClient as never,
      WSClient: FakeWS as never,
      EventDispatcher: FakeDispatcher as never,
    },
    h.store,
    { appId: "cli_voice" },
    {
      asr: {
        async stageAudio(data, input) {
          assert.equal(data.subarray(0, 4).toString("ascii"), "RIFF");
          return {
            id: "00000000-0000-4000-8000-000000000031",
            digest: createHash("sha256").update(data).digest("hex"),
            mediaType: "audio/wav",
            bytes: data.length,
            durationMs: 1_000,
            source: "im",
            ownerOperation: input.ownerOperation,
            expiresAt: Date.now() + 60_000,
          };
        },
        async transcribe(handle) {
          return {
            handle,
            draft: { text: "飞书语音指令", confirmed: false, language: "zh", emotion: "SAD" },
            draftDigest: createHash("sha256").update("飞书语音指令").digest("hex"),
          };
        },
      },
      tts: {
        async synthesize(request) {
          return {
            handle: {
              id: "00000000-0000-4000-8000-000000000032",
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
    },
  );
  await adapter.connect("cli_voice", "fixture-secret");
  adapter.setOwner("ou_owner", "explicit");
  const { token } = h.plane.createPairing({ workspaceIdentity: "ws", sessionId: "sess", adapter: "feishu" });
  const bind = adapter.enqueueReceive({
    header: { app_id: "cli_voice" },
    event: {
      message: {
        message_id: "om_bind_1",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: `/绑定 ${token}` }),
      },
      sender: { sender_id: { open_id: "ou_owner" } },
    },
  });
  assert.deepEqual(bind, { accepted: true });
  await adapter.lastEnqueue;
  const voice = adapter.enqueueReceive({
    header: { app_id: "cli_voice" },
    event: {
      message: {
        message_id: "om_voice_1",
        chat_type: "p2p",
        message_type: "audio",
        content: JSON.stringify({ file_key: "file_voice_1", duration: 1_000 }),
      },
      sender: { sender_id: { open_id: "ou_owner" } },
    },
  });
  assert.deepEqual(voice, { accepted: true });
  await waitFor(() => h.inputs.length === 1);
  assert.equal(h.inputs[0]?.text, "飞书语音指令");
  assert.deepEqual(h.inputs[0]?.source.voice, { language: "zh", emotion: "SAD", durationMs: 1_000 });
  const input = h.inputs[0]!;
  h.plane.onClaimed({
    dshMessageId: `dsh_${input.inboundId}`,
    turnId: "fs-turn-1",
    sessionId: "sess",
    source: input.source,
  });
  h.plane.onAssistantFinal({ sessionId: "sess", turnId: "fs-turn-1", text: "飞书最终回复" });
  await adapter.pumpOutbox(input.routeId, "ou_owner");
  await adapter.pumpOutbox(input.routeId, "ou_owner");
  assert.equal(uploads.length, 1);
  const uploadData = (uploads[0]?.data ?? {}) as Record<string, unknown>;
  assert.equal(uploadData.file_type, "opus");
  assert.equal(Buffer.from(uploadData.file as Buffer).subarray(0, 4).toString("ascii"), "OggS");
  // The /绑定 command ack is a text message; the voice reply is the audio one.
  const audioCreated = created.filter((c) => (c?.data as Record<string, unknown>)?.msg_type === "audio");
  assert.equal(audioCreated.length, 1);
  const messageData = (audioCreated[0]?.data ?? {}) as Record<string, unknown>;
  assert.equal(messageData.msg_type, "audio");
  assert.equal(String(messageData.content).includes("uploaded_opus_1"), true);
  assert.equal(h.store.pendingOutbox(input.routeId).length, 0);
  adapter.stop();
  h.store.close();
});

test("Feishu office return uploads and sends the exact file bytes", async () => {
  const uploads: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  class FakeClient {
    im = {
      file: {
        create: async (request: Record<string, unknown>) => {
          uploads.push(request);
          return { file_key: "office-file-key" };
        },
      },
      message: {
        create: async (request: Record<string, unknown>) => { messages.push(request); return {}; },
        reply: async () => ({}),
      },
    };
  }
  class FakeDispatcher { register() { return this; } }
  class FakeWS { async start() {} close() {} }
  const routing = plane();
  const adapter = new FeishuAdapter(routing, "cli_office", {
    Client: FakeClient as never,
    WSClient: FakeWS as never,
    EventDispatcher: FakeDispatcher as never,
  });
  await adapter.connect("cli_office", "fixture-secret");
  const bytes = Buffer.from("office-file-bytes");
  assert.deepEqual(await adapter.sendFile("ou_owner", bytes, "report.xlsx"), { ok: true });
  assert.equal(uploads.length, 1);
  const uploadData = uploads[0]?.data as Record<string, unknown>;
  assert.equal(uploadData.file_type, "stream");
  assert.equal(uploadData.file_name, "report.xlsx");
  assert.equal(Buffer.from(uploadData.file as Buffer).equals(bytes), true);
  assert.equal(messages.length, 1);
  const messageData = messages[0]?.data as Record<string, unknown>;
  assert.equal(messageData.receive_id, "ou_owner");
  assert.equal(messageData.msg_type, "file");
  assert.equal(String(messageData.content).includes("office-file-key"), true);
  adapter.stop();
});

test("Feishu scanner identity is the unique allowlist and first DMs do not become owner", async () => {
  const h = voicePlane();
  const notices: string[] = [];
  class FakeClient {
    im = {
      message: {
        create: async (req: { data: { receive_id: string; content: string } }) => {
          notices.push(`${req.data.receive_id}:${req.data.content}`);
          return {};
        },
        reply: async () => ({}),
      },
    };
  }
  class FakeDispatcher {
    register() { return this; }
  }
  class FakeWS {
    async start() {}
    close() {}
  }
  const adapter = new FeishuAdapter(
    h.plane,
    "cli_owner",
    {
      Client: FakeClient as never,
      WSClient: FakeWS as never,
      EventDispatcher: FakeDispatcher as never,
    },
    h.store,
    { appId: "cli_owner" },
  );
  await adapter.connect("cli_owner", "fixture-secret");
  assert.equal(adapter.ownerKnown, false);
  const stranger = adapter.enqueueReceive({
    header: { app_id: "cli_owner" },
    event: {
      message: {
        message_id: "om_stranger",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "你好" }),
      },
      sender: { sender_id: { open_id: "ou_stranger" } },
    },
  });
  assert.deepEqual(stranger, { reject: "allowlist" });
  assert.equal(adapter.ownerKnown, false);
  assert.equal(h.inputs.length, 0);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(notices.some((row) => row.startsWith("ou_stranger:") && row.includes("Penglai only replies")));
  assert.match(FEISHU_ALLOWLIST_NOTICE, /扫码确认/);

  adapter.setOwner("ou_owner", "registration");
  const owner = adapter.enqueueReceive({
    header: { app_id: "cli_owner" },
    event: {
      message: {
        message_id: "om_owner",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "你好" }),
      },
      sender: { sender_id: { open_id: "ou_owner" } },
    },
  });
  assert.deepEqual(owner, { accepted: true });
  await adapter.lastEnqueue;
  assert.equal(h.inputs.length, 1);

  const intruder = adapter.enqueueReceive({
    header: { app_id: "cli_owner" },
    event: {
      message: {
        message_id: "om_intruder",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "偷用" }),
      },
      sender: { sender_id: { open_id: "ou_intruder" } },
    },
  });
  assert.deepEqual(intruder, { reject: "allowlist" });
  assert.equal(h.inputs.length, 1);

  const restarted = new FeishuAdapter(h.plane, "cli_owner", undefined, h.store);
  assert.equal(restarted.ownerKnown, true);
  assert.equal(restarted.assertAllowlisted("ou_owner"), "ok");
  assert.equal(restarted.assertAllowlisted("ou_intruder"), "allowlist");
  const audit = h.store.listAudit();
  assert.equal(audit.some((row) => row.event === "feishu.owner" && row.payload.source === "registration"), true);
  assert.equal(JSON.stringify(audit).includes("ou_owner"), false);
  adapter.stop();
  h.store.close();
});
