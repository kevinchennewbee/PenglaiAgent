import assert from "node:assert/strict";
import test from "node:test";
import { WhatsAppDeviceAdapter, WHATSAPP_RISK_ACK_VERSION } from "./index.js";

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
