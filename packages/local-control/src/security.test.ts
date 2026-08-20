import assert from "node:assert/strict";
import test from "node:test";
import { SeqIds, VirtualClock } from "@penglai/testkit";
import { Store } from "@penglai/persistence";
import { RoutingControlPlane } from "@penglai/routing-core";
import { startControlServer } from "./index.js";

function plane() {
  return new RoutingControlPlane(
    new Store(":memory:"),
    new VirtualClock(),
    new SeqIds(),
    { async listWorkspaces() { return []; }, async listSessions() { return []; } },
    { async followup() { return { dshMessageId: "d" }; }, async steer() { return { dshMessageId: "d" }; }, async cancelCurrent() {}, async removeInbox() {} },
  );
}

test("R1-DESK-007 missing token rejected", async () => {
  const srv = await startControlServer(plane(), { token: "a".repeat(32) });
  const res = await fetch(`http://127.0.0.1:${srv.port}/v1/pair`, { method: "POST", body: "{}" });
  assert.equal(res.status, 401);
  await srv.close();
});

test("R2-WEB-006 prefix origin rejected", async () => {
  const { startDshProxy } = await import("./proxy.js");
  const proxy = await startDshProxy({ token: "d".repeat(64), innerPort: 9 });
  const res = await fetch(`http://127.0.0.1:${proxy.port}/`, {
    headers: { origin: "http://127.0.0.1.evil.example", "x-penglai-token": "d".repeat(64) },
  });
  assert.equal(res.status, 403);
  await proxy.close();
});

test("wrong origin rejected", async () => {
  const token = "b".repeat(32);
  const srv = await startControlServer(plane(), { token });
  const res = await fetch(`http://127.0.0.1:${srv.port}/v1/pair`, {
    method: "POST",
    headers: { "x-penglai-token": token, origin: "https://evil.example" },
    body: JSON.stringify({ workspaceIdentity: "w", sessionId: "s" }),
  });
  assert.equal(res.status, 403);
  await srv.close();
});

test("proxy upgrade close does not throw writeAfterFIN", async () => {
  const { createServer } = await import("node:http");
  const inner = createServer();
  inner.on("upgrade", (_req, socket) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.end();
  });
  await new Promise<void>((resolve) => inner.listen(0, "127.0.0.1", resolve));
  const addr = inner.address();
  const innerPort = !addr || typeof addr === "string" ? 0 : addr.port;
  const { startDshProxy } = await import("./proxy.js");
  const token = "e".repeat(32);
  const proxy = await startDshProxy({ token, innerPort });
  const req = await import("node:http").then((h) =>
    h.request({
      host: "127.0.0.1",
      port: proxy.port,
      path: "/api/events.host",
      headers: { upgrade: "websocket", connection: "upgrade", "x-penglai-token": token },
    }),
  );
  const done = new Promise<void>((resolve) => {
    req.on("upgrade", (_res, socket) => {
      socket.on("error", () => resolve());
      socket.end();
      resolve();
    });
    req.on("error", () => resolve());
  });
  req.end();
  await Promise.race([done, new Promise((r) => setTimeout(r, 1000))]);
  await proxy.close();
  await new Promise<void>((resolve) => inner.close(() => resolve()));
});

test("diagnostics require token", async () => {
  const token = "c".repeat(32);
  const srv = await startControlServer(plane(), { token });
  const denied = await fetch(`http://127.0.0.1:${srv.port}/v1/diagnostics`);
  assert.equal(denied.status, 401);
  const ok = await fetch(`http://127.0.0.1:${srv.port}/v1/diagnostics`, { headers: { "x-penglai-token": token } });
  assert.equal(ok.status, 200);
  await srv.close();
});
