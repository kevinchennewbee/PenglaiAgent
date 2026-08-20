import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { startDshProxy, WIZARD_CSP } from "./proxy.js";

function tokenHeaders(token: string): HeadersInit {
  return { "x-penglai-token": token };
}

function rawGet(port: number, path: string, token: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, headers: tokenHeaders(token) },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("wizard static is token-gated, CSP-locked, and jailed", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-wiz-"));
  writeFileSync(join(root, "index.html"), "<!doctype html><html><body data-penglai-wizard=1></body></html>\n");
  writeFileSync(join(root, "app.js"), "window.__WIZ=1;\n");
  writeFileSync(join(root, "secret.txt"), "nope\n");
  const token = "f".repeat(32);
  const proxy = await startDshProxy({ token, innerPort: 9, wizard: { root } });
  try {
    const base = `http://127.0.0.1:${proxy.port}`;

    const denied = await fetch(`${base}/wizard/`);
    assert.equal(denied.status, 401);

    const page = await fetch(`${base}/wizard/`, { headers: tokenHeaders(token) });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("content-type")?.includes("text/html"), true);
    assert.equal(page.headers.get("content-security-policy"), WIZARD_CSP);
    assert.match(await page.text(), /data-penglai-wizard/);

    const js = await fetch(`${base}/wizard/app.js`, { headers: tokenHeaders(token) });
    assert.equal(js.status, 200);
    assert.match(String(js.headers.get("content-type")), /javascript/);

    const txt = await fetch(`${base}/wizard/secret.txt`, { headers: tokenHeaders(token) });
    assert.equal(txt.status, 403);

    const encoded = await rawGet(proxy.port, "/wizard/%2e%2e/secret.txt", token);
    assert.equal(encoded.status, 403);
    assert.equal(encoded.body.includes("nope"), false);

    const fallback = await fetch(`${base}/wizard/unknown-step`, { headers: tokenHeaders(token) });
    assert.equal(fallback.status, 200);
    assert.match(await fallback.text(), /data-penglai-wizard/);
  } finally {
    await proxy.close();
  }
});

test("wizard is gone after the onboarding ledger is COMPLETE", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-wiz-off-"));
  writeFileSync(join(root, "index.html"), "<!doctype html><html><body data-penglai-wizard=1></body></html>\n");
  const token = "h".repeat(32);
  const proxy = await startDshProxy({ token, innerPort: 9, wizard: { root } });
  try {
    const before = await fetch(`http://127.0.0.1:${proxy.port}/wizard/`, { headers: tokenHeaders(token) });
    assert.equal(before.status, 200);
    proxy.setWizardDisabled(true);
    const after = await fetch(`http://127.0.0.1:${proxy.port}/wizard/`, { headers: tokenHeaders(token) });
    assert.equal(after.status, 410);
    assert.match(await after.text(), /wizard-complete/);
    const js = await fetch(`http://127.0.0.1:${proxy.port}/wizard/app.js`, { headers: tokenHeaders(token) });
    assert.equal(js.status, 410);
  } finally {
    await proxy.close();
  }
});

test("wizard starts disabled when the ledger is already COMPLETE", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-wiz-done-"));
  writeFileSync(join(root, "index.html"), "<!doctype html><html><body data-penglai-wizard=1></body></html>\n");
  const token = "i".repeat(32);
  const proxy = await startDshProxy({ token, innerPort: 9, wizard: { root, disabled: true } });
  try {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/wizard/`, { headers: tokenHeaders(token) });
    assert.equal(res.status, 410);
  } finally {
    await proxy.close();
  }
});

test("wizard root missing does not crash the proxy", async () => {
  const missing = join(mkdtempSync(join(tmpdir(), "penglai-wiz-miss-")), "nope");
  const token = "g".repeat(32);
  const proxy = await startDshProxy({ token, innerPort: 9, wizard: { root: missing } });
  const res = await fetch(`http://127.0.0.1:${proxy.port}/wizard/`, { headers: tokenHeaders(token) });
  assert.equal(res.status, 404);
  await proxy.close();
});

test("authenticated proxy gives Penglai brand assets browser-safe MIME types", async () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const inner = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(req.url?.endsWith(".png") ? png : "asset");
  });
  await new Promise<void>((resolve) => inner.listen(0, "127.0.0.1", resolve));
  const address = inner.address();
  assert.ok(address && typeof address !== "string");
  const token = "b".repeat(32);
  const proxy = await startDshProxy({ token, innerPort: address.port });
  try {
    const branded = await fetch(`http://127.0.0.1:${proxy.port}/penglai-brand/logo-64.png`, { headers: tokenHeaders(token) });
    assert.equal(branded.status, 200);
    assert.equal(branded.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await branded.arrayBuffer()), png);

    const ordinary = await fetch(`http://127.0.0.1:${proxy.port}/api/state.json`, { headers: tokenHeaders(token) });
    assert.equal(ordinary.headers.get("content-type"), "application/octet-stream");
  } finally {
    await proxy.close();
    await new Promise<void>((resolve, reject) => inner.close((error) => error ? reject(error) : resolve()));
  }
});
