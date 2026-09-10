import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ObjectStore,
  officialFileDigest,
  sanitizeOfficialFileName,
  type InboundEnvelope,
  type ModelInput,
  type OfficialFileRef,
} from "@penglai/contracts";
import { Store } from "@penglai/persistence";
import { SeqIds, VirtualClock, tmpDb } from "@penglai/testkit";
import { RoutingControlPlane, type AgentPort, type DirectoryPort } from "./index.js";

function officialFile(bytes: Buffer, name: string): OfficialFileRef {
  return {
    attachmentId: `sha256:${officialFileDigest(bytes)}`,
    name: sanitizeOfficialFileName(name),
    bytes: bytes.byteLength,
  };
}

function env(over: Partial<InboundEnvelope> = {}): InboundEnvelope {
  return {
    adapter: "weixin",
    adapterMessageKey: over.adapterMessageKey ?? "k1",
    accountRef: "acct",
    peerRef: "peer",
    vendorTarget: "owner",
    chatKind: "private",
    bodyKind: "text",
    text: "hello",
    receivedAt: 1,
    ...over,
  };
}

function planeWith(
  store: Store,
  agent: AgentPort,
  objects?: ObjectStore,
): RoutingControlPlane {
  const directory: DirectoryPort = {
    async listWorkspaces() {
      return [{ id: "ws", title: "WS" }];
    },
    async listSessions() {
      return [{ id: "sess" }];
    },
  };
  return new RoutingControlPlane(store, new VirtualClock(), new SeqIds(), directory, agent, objects);
}

async function bind(plane: RoutingControlPlane): Promise<void> {
  const { token } = plane.createPairing({ workspaceIdentity: "ws", sessionId: "sess", adapter: "weixin" });
  const reply = await plane.submitInbound(env({ adapterMessageKey: "bind", text: `/绑定 ${token}` }));
  assert.equal(reply.kind, "control");
}

test("recoverQueuedInbounds rebuilds official FileBlock after a failed first followup and store reopen", async () => {
  const path = tmpDb();
  const bytes = Buffer.from("hello-bin");
  const file = officialFile(bytes, "a.bin");
  const inputs: ModelInput[] = [];
  let boom = true;
  const agent: AgentPort = {
    async followup(input) {
      inputs.push(input);
      if (boom) throw new Error("DSH down");
      return { dshMessageId: `dsh_${input.inboundId}` };
    },
    async steer(input) {
      inputs.push(input);
      return { dshMessageId: input.inboundId };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  };
  const store = new Store(path);
  const plane = planeWith(store, agent);
  await bind(plane);
  const first = await plane.submitInbound(
    env({
      adapterMessageKey: "bin-1",
      bodyKind: "media",
      text: "",
      media: {
        kind: "file",
        source: "weixin",
        sourceMessageId: "bin-1",
        sourceResourceId: "cdn-bin",
        mime: "application/octet-stream",
        filename: "a.bin",
        size: bytes.length,
        sha256: officialFileDigest(bytes),
        opaqueHandle: "media-bin",
        officialFile: file,
      },
    }),
  );
  assert.equal(first.kind, "rejected");
  assert.equal(inputs.at(-1)?.files?.[0]?.attachmentId, file.attachmentId);
  assert.equal(store.queuedWithoutDshId().length, 1);
  store.close();

  boom = false;
  const reopened = new Store(path);
  const recoveredInputs: ModelInput[] = [];
  const recovered = planeWith(reopened, {
    async followup(input) {
      recoveredInputs.push(input);
      return { dshMessageId: `dsh_${input.inboundId}` };
    },
    async steer(input) {
      recoveredInputs.push(input);
      return { dshMessageId: input.inboundId };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  const result = await recovered.recoverQueuedInbounds();
  assert.equal(result.dispatched, 1);
  assert.equal(recoveredInputs.at(-1)?.files?.[0]?.attachmentId, file.attachmentId);
  assert.equal(recoveredInputs.at(-1)?.files?.[0]?.name, "a.bin");
  assert.equal(recoveredInputs.at(-1)?.recovery, true);
  assert.equal(reopened.queuedWithoutDshId().length, 0);
  reopened.close();
});

test("recovery preserves official image and office/audio handles bound to the same session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-receipt-"));
  const objects = new ObjectStore(dir);
  const pdf = Buffer.from("%PDF-1.4 test");
  const { handle: officeHandle } = objects.put(pdf, { kind: "pdf", mime: "application/pdf" });
  const { handle: audioHandle } = objects.put(Buffer.from("RIFF"), { kind: "audio", mime: "audio/wav" });
  const file = officialFile(pdf, "note.pdf");
  const image = {
    attachmentId: "att-img",
    mediaType: "image/png" as const,
    bytes: 67,
    width: 1,
    height: 1,
    name: "a.png",
  };
  const inputs: ModelInput[] = [];
  let boom = true;
  const store = new Store(":memory:");
  const plane = planeWith(
    store,
    {
      async followup(input) {
        inputs.push(input);
        if (boom) throw new Error("DSH down");
        return { dshMessageId: `dsh_${input.inboundId}` };
      },
      async steer() {
        return { dshMessageId: "s" };
      },
      async cancelCurrent() {},
      async removeInbox() {},
    },
    objects,
  );
  await bind(plane);
  const routeId = store.findRoute("weixin", "acct", "peer")!.routeId;
  objects.bind(officeHandle, { sessionId: "sess", workspaceId: "ws", routeId });
  objects.bind(audioHandle, { sessionId: "sess", workspaceId: "ws", routeId });
  await plane.submitInbound(
    env({
      adapterMessageKey: "img-1",
      bodyKind: "media",
      text: "",
      media: {
        kind: "image",
        source: "weixin",
        sourceMessageId: "img-1",
        sourceResourceId: "cdn-img",
        mime: "image/png",
        size: 67,
        sha256: "a".repeat(64),
        opaqueHandle: "media-img",
        officialImage: image,
      },
    }),
  );
  await plane.submitInbound(
    env({
      adapterMessageKey: "pdf-1",
      bodyKind: "media",
      text: "",
      media: {
        kind: "pdf",
        source: "weixin",
        sourceMessageId: "pdf-1",
        sourceResourceId: "cdn-pdf",
        mime: "application/pdf",
        filename: "note.pdf",
        size: pdf.length,
        sha256: officialFileDigest(pdf),
        opaqueHandle: "media-pdf",
        officialFile: file,
        officeHandle,
      },
    }),
  );
  await plane.submitInbound(
    env({
      adapterMessageKey: "aud-1",
      bodyKind: "media",
      text: "",
      media: {
        kind: "audio",
        source: "feishu",
        sourceMessageId: "aud-1",
        sourceResourceId: "cdn-aud",
        mime: "audio/wav",
        size: 4,
        sha256: "c".repeat(64),
        opaqueHandle: "media-aud",
        audioHandle,
      },
    }),
  );
  boom = false;
  const recovered = await plane.recoverQueuedInbounds();
  assert.equal(recovered.dispatched, 3);
  assert.deepEqual(inputs.at(-3)?.images, [image]);
  assert.equal(inputs.at(-2)?.files?.[0]?.attachmentId, file.attachmentId);
  assert.equal(inputs.at(-2)?.officeHandle, officeHandle);
  assert.equal(inputs.at(-1)?.audioHandle, audioHandle);
  store.close();
});

test("missing, tampered, or stale media receipts fail closed instead of caption-only replay", async () => {
  const file = officialFile(Buffer.from("hello-bin"), "a.bin");
  const store = new Store(":memory:");
  let boom = true;
  const plane = planeWith(store, {
    async followup() {
      if (boom) throw new Error("DSH down");
      return { dshMessageId: "dsh" };
    },
    async steer() {
      return { dshMessageId: "s" };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  await bind(plane);
  await plane.submitInbound(
    env({
      adapterMessageKey: "bin-missing",
      bodyKind: "media",
      text: "",
      media: {
        kind: "file",
        source: "weixin",
        sourceMessageId: "bin-missing",
        sourceResourceId: "cdn",
        mime: "application/octet-stream",
        filename: "a.bin",
        size: 9,
        sha256: officialFileDigest(Buffer.from("hello-bin")),
        opaqueHandle: "media-bin",
        officialFile: file,
      },
    }),
  );
  const inboundId = store.queuedWithoutDshId()[0]!.inboundId;
  store.deleteInboundMediaReceipt(inboundId);
  boom = false;
  const missing = await plane.recoverQueuedInbounds();
  assert.equal(missing.rejected, 1);
  assert.equal(missing.dispatched, 0);
  assert.equal(store.getInbound(inboundId)?.state, "no_delivery");

  const store2 = new Store(":memory:");
  boom = true;
  const plane2 = planeWith(store2, {
    async followup() {
      if (boom) throw new Error("DSH down");
      return { dshMessageId: "dsh" };
    },
    async steer() {
      return { dshMessageId: "s" };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  await bind(plane2);
  await plane2.submitInbound(
    env({
      adapterMessageKey: "bin-tamper",
      bodyKind: "media",
      text: "",
      media: {
        kind: "file",
        source: "weixin",
        sourceMessageId: "bin-tamper",
        sourceResourceId: "cdn",
        mime: "application/octet-stream",
        filename: "a.bin",
        size: 9,
        sha256: officialFileDigest(Buffer.from("hello-bin")),
        opaqueHandle: "media-bin",
        officialFile: file,
      },
    }),
  );
  const tamperId = store2.queuedWithoutDshId()[0]!.inboundId;
  store2.db
    .prepare("UPDATE inbound_media_receipts SET receipt_json=? WHERE inbound_id=?")
    .run(JSON.stringify({ schema: 1, kind: "file", officialFile: { attachmentId: "/tmp/x", name: "a.bin", bytes: 9 } }), tamperId);
  boom = false;
  const tampered = await plane2.recoverQueuedInbounds();
  assert.equal(tampered.rejected, 1);
  assert.equal(tampered.dispatched, 0);

  const store3 = new Store(":memory:");
  boom = true;
  const plane3 = planeWith(store3, {
    async followup() {
      if (boom) throw new Error("DSH down");
      return { dshMessageId: "dsh" };
    },
    async steer() {
      return { dshMessageId: "s" };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  await bind(plane3);
  await plane3.submitInbound(
    env({
      adapterMessageKey: "bin-stale",
      bodyKind: "media",
      text: "",
      media: {
        kind: "file",
        source: "weixin",
        sourceMessageId: "bin-stale",
        sourceResourceId: "cdn",
        mime: "application/octet-stream",
        filename: "a.bin",
        size: 9,
        sha256: officialFileDigest(Buffer.from("hello-bin")),
        opaqueHandle: "media-bin",
        officialFile: file,
      },
    }),
  );
  const routeId = store3.findRoute("weixin", "acct", "peer")!.routeId;
  store3.putBinding({
    routeId,
    workspaceIdentity: "other-ws",
    sessionId: "other-sess",
    revision: 99,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  boom = false;
  const stale = await plane3.recoverQueuedInbounds();
  assert.equal(stale.rejected, 1);
  assert.equal(stale.dispatched, 0);
  store.close();
  store2.close();
  store3.close();
});

test("ordinary text recovery stays caption-compatible and does not require a media receipt", async () => {
  const inputs: ModelInput[] = [];
  let boom = true;
  const store = new Store(":memory:");
  const plane = planeWith(store, {
    async followup(input) {
      inputs.push(input);
      if (boom) throw new Error("DSH down");
      return { dshMessageId: `dsh_${input.inboundId}` };
    },
    async steer() {
      return { dshMessageId: "s" };
    },
    async cancelCurrent() {},
    async removeInbox() {},
  });
  await bind(plane);
  await plane.submitInbound(env({ adapterMessageKey: "t1", text: "plain hello" }));
  boom = false;
  const recovered = await plane.recoverQueuedInbounds();
  assert.equal(recovered.dispatched, 1);
  assert.equal(inputs.at(-1)?.text, "plain hello");
  assert.equal(inputs.at(-1)?.files, undefined);
  assert.equal(inputs.at(-1)?.images, undefined);
  store.close();
});
