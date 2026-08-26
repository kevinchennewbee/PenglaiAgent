import assert from "node:assert/strict";
import test from "node:test";
import { SerializedWhatsAppAuthWriter, WhatsAppDeviceAdapter, WHATSAPP_RISK_ACK_VERSION } from "./index.js";

test("WhatsApp auth writes serialize, flush, and fail closed", async () => {
  const writes: number[] = [];
  let releaseFirst: (() => void) | undefined;
  const first = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const writer = new SerializedWhatsAppAuthWriter({
    async read() { return undefined; },
    async write(bytes) {
      writes.push(bytes[0]!);
      if (bytes[0] === 1) await first;
    },
    async wipe() {},
  });
  const one = writer.enqueue(new Uint8Array([1]));
  const two = writer.enqueue(new Uint8Array([2]));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, [1]);
  releaseFirst!();
  await Promise.all([one, two]);
  await writer.stop();
  assert.deepEqual(writes, [1, 2]);
  await assert.rejects(() => writer.enqueue(new Uint8Array([3])), /WRITER_CLOSED/);

  let code = "";
  const failed = new SerializedWhatsAppAuthWriter(
    { async read() { return undefined; }, async write() { throw new Error("disk"); }, async wipe() {} },
    (next) => { code = next; },
  );
  await assert.rejects(() => failed.enqueue(new Uint8Array([4])), /disk/);
  await assert.rejects(() => failed.flush(), /WHATSAPP_AUTH_PERSIST_FAILED/);
  assert.equal(code, "WHATSAPP_AUTH_PERSIST_FAILED");
});

test("WhatsApp requires risk ack, reserves outbound ids, and wipes on logout", async () => {
  let wiped = false;
  const adapter = new WhatsAppDeviceAdapter(
    {
      async read() {
        return undefined;
      },
      async write() {},
      async wipe() {
        wiped = true;
      },
    },
    async ({ onOpen }) => {
      onOpen();
      return {
        async send() {},
        async logout() {},
      };
    },
  );
  await assert.rejects(() => adapter.beginConnection({ method: "device-link" }), /CHANNEL_RISK_ACK/);
  await adapter.beginConnection({ method: "device-link", riskAck: true });
  assert.equal(adapter.health().riskAckVersion, WHATSAPP_RISK_ACK_VERSION);
  const id = adapter.reserveOutboundId();
  assert.equal(adapter.isEcho(id), true);
  const restored = new WhatsAppDeviceAdapter(
    {
      async read() {
        return undefined;
      },
      async write() {},
      async wipe() {},
    },
    async ({ onOpen }) => {
      onOpen();
      return { async send() {}, async logout() {} };
    },
  );
  restored.restorePersistedState(adapter.exportPersistedState());
  assert.equal(restored.isEcho(id), true);
  await adapter.logout();
  assert.equal(wiped, true);
  assert.equal(adapter.health().connection, "disabled");
});

test("WhatsApp reconnects a dropped device link and stops reconnecting after logout", async () => {
  let starts = 0;
  let closeLink: (() => void) | undefined;
  const adapter = new WhatsAppDeviceAdapter(
    { async read() { return undefined; }, async write() {}, async wipe() {} },
    async ({ onOpen, onClose }) => {
      starts += 1;
      closeLink = onClose;
      onOpen();
      return { async send() {}, async logout() {}, async close() {} };
    },
    [0],
  );
  await adapter.beginConnection({ method: "device-link", riskAck: true });
  assert.equal(starts, 1);
  closeLink?.();
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  assert.equal(starts, 2);
  assert.equal(adapter.health().connection, "connected");
  await adapter.logout();
  closeLink?.();
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  assert.equal(starts, 2);
});
