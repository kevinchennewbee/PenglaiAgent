import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import { IMessageAdapter } from "@penglai/channel-imessage";
import { imessageChannelAdapter } from "./adapters/channel-bridge.js";
import { createRuntime } from "./index.js";
import { CredentialsServiceVault } from "./credentials-vault.js";
import { PenglaiImHost } from "./host.js";

test("iMessage host inspect and enable never count permission-denied or Windows as connected", async () => {
  let execs = 0;
  const dsh = {
    version: "0.1.5-rc.1",
    getAgent: () => undefined,
    listWorkspaces: () => [{ id: "w", title: "W", sessionIds: ["s"] }],
  };
  const rt = createRuntime({ dbPath: ":memory:", host: dsh });
  const host = new PenglaiImHost(
    rt.store,
    rt.plane,
    { health: () => ({ authState: "idle", hasCredential: false }) } as never,
    { status: "idle", setupRequired: true } as never,
    new CredentialsServiceVault(undefined),
    {} as never,
    dsh,
  );
  const key = randomBytes(32);
  const native = new IMessageAdapter({
    platform: "win32",
    execFileImpl: async () => {
      execs += 1;
      throw new Error("macOS helper must not run");
    },
  });
  host.attachChannelAdapter(
    imessageChannelAdapter(native, {
      hashPeer: (senderId, accountRef) =>
        createHmac("sha256", key).update(`imessage\0${accountRef}\0${senderId}`).digest("hex"),
    }),
  );
  const permissions = await host.inspectIMessagePermissions();
  assert.equal(permissions.database, "unsupported");
  assert.equal(permissions.automation, "unsupported");
  const overview = await host.getOverview();
  const card = overview.channels.find((row) => row.channel === "imessage");
  assert.equal(card?.connection, "blocked");
  assert.notEqual(card?.connection, "connected");
  const begun = await host.beginChannelConnection({ channel: "imessage", method: "manual-fallback" });
  assert.equal("failure" in begun, true);
  if ("failure" in begun) {
    assert.notEqual(begun.failure.code, undefined);
  }
  assert.equal(execs, 0);
  rt.store.close();
});
