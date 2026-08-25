import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { EncryptedWhatsAppSessionStore } from "./session-store.js";

test("WhatsApp session store encrypts on disk and wipes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-wa-"));
  const store = new EncryptedWhatsAppSessionStore(join(dir, "whatsapp.session"), randomBytes(32));
  const payload = new Uint8Array([1, 2, 3, 4]);
  await store.write(payload);
  const read = await store.read();
  assert.deepEqual(read && [...read], [1, 2, 3, 4]);
  await store.wipe();
  assert.equal(await store.read(), undefined);
});
