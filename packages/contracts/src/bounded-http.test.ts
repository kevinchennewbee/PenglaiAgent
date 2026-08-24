import assert from "node:assert/strict";
import test from "node:test";
import { PenglaiError } from "./errors.js";
import { readBoundedJson, readBoundedResponse } from "./bounded-http.js";

function streamResponse(
  pull: (controller: ReadableStreamDefaultController<Uint8Array>) => void | Promise<void>,
  init?: ResponseInit,
): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        await pull(controller);
      },
    }),
    { status: 200, ...init },
  );
}

test("R56-SEC-005 declared content-length above the bound aborts before reading", async () => {
  const logs: Array<Record<string, unknown>> = [];
  const response = new Response("tiny", {
    status: 200,
    headers: { "content-length": "999999999", "content-type": "application/json" },
  });
  await assert.rejects(
    () =>
      readBoundedResponse({
        response,
        maxBytes: 1024,
        category: "registry-metadata",
        onLog: (log) => logs.push({ ...log }),
      }),
    (error: unknown) =>
      error instanceof PenglaiError &&
      error.errorClass === "SECURITY_POLICY" &&
      error.message === "BOUNDED_HTTP_DECLARED_LENGTH",
  );
  assert.equal(logs[0]?.category, "registry-metadata");
  assert.equal(logs[0]?.errorClass, "SECURITY_POLICY");
  assert.equal(JSON.stringify(logs).includes("tiny"), false);
});

test("R56-SEC-005 fake short content-length still bounds actual streamed bytes", async () => {
  const body = Buffer.alloc(64, 0x61);
  const response = new Response(body, {
    status: 200,
    headers: { "content-length": "4", "content-type": "application/json" },
  });
  await assert.rejects(
    () =>
      readBoundedResponse({
        response,
        maxBytes: 16,
        category: "weixin-ilink",
      }),
    /BOUNDED_HTTP_TOO_LARGE/,
  );
});

test("R56-SEC-005 infinite chunks abort at the byte bound", async () => {
  const response = streamResponse((controller) => {
    controller.enqueue(new Uint8Array(32 * 1024));
  });
  await assert.rejects(
    () =>
      readBoundedResponse({
        response,
        maxBytes: 8 * 1024,
        category: "generic",
        timeoutMs: 2_000,
      }),
    /BOUNDED_HTTP_TOO_LARGE/,
  );
});

test("R56-SEC-005 slow streams fail closed on the total timeout", async () => {
  const response = streamResponse(async (controller) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.enqueue(new Uint8Array([1]));
    controller.close();
  });
  await assert.rejects(
    () =>
      readBoundedResponse({
        response,
        maxBytes: 1024,
        category: "generic",
        timeoutMs: 40,
      }),
    (error: unknown) =>
      error instanceof PenglaiError &&
      error.errorClass === "DELIVERY_TRANSIENT" &&
      error.message === "BOUNDED_HTTP_TIMEOUT",
  );
});

test("R56-SEC-005 caller cancel does not wait for the body", async () => {
  const abort = new AbortController();
  const response = streamResponse(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  });
  const pending = readBoundedResponse({
    response,
    maxBytes: 1024,
    category: "feishu-registration",
    signal: abort.signal,
  });
  abort.abort();
  await assert.rejects(
    () => pending,
    (error: unknown) =>
      error instanceof PenglaiError &&
      error.errorClass === "DELIVERY_TRANSIENT" &&
      error.message === "BOUNDED_HTTP_CANCELED",
  );
});

test("R56-SEC-005 unexpected MIME is rejected before JSON parse", async () => {
  const response = new Response("<html>not json</html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  await assert.rejects(
    () =>
      readBoundedJson({
        response,
        maxBytes: 1024,
        category: "weixin-ilink",
        mimeAllowed: (value) => value === "application/json",
      }),
    /BOUNDED_HTTP_MIME/,
  );
});

test("R56-SEC-005 JSON is parsed only after the byte bound succeeds", async () => {
  const response = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const parsed = await readBoundedJson({
    response,
    maxBytes: 1024,
    category: "registry-metadata",
  });
  assert.deepEqual(parsed.value, { ok: true });
  assert.equal(parsed.status, 200);
});
