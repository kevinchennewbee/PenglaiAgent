import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MediaStore,
  ObjectStore,
  attachDownloadedMedia,
  imageMediaTypeFromBytes,
  isDiagnosticMediaCaption,
  userFacingMediaPrompt,
} from "./index.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("image magic maps to official DSH media types", () => {
  assert.equal(imageMediaTypeFromBytes(PNG), "image/png");
  assert.equal(isDiagnosticMediaCaption("[penglai-media kind=image mime=image/png sha256=abcd handle=x]"), true);
  assert.equal(isDiagnosticMediaCaption("hello"), false);
});

test("object store binds handles to a session", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-objects-"));
  const store = new ObjectStore(dir);
  const { handle } = store.put(Buffer.from("docx"), { kind: "office", mime: "application/vnd.openxmlformats-officedocument" });
  assert.throws(() => store.get(handle, "sess-1"), /bound|UNAUTHORIZED/i);
  store.bind(handle, { sessionId: "sess-1", workspaceId: "ws" });
  assert.equal(store.get(handle, "sess-1").toString(), "docx");
  assert.throws(() => store.get(handle, "sess-2"), /bound|UNAUTHORIZED/i);
  assert.throws(() => store.bind("../escape", { sessionId: "sess-1" }), /handle rejected/i);
  assert.throws(() => store.get("obj-not-a-real-handle000000", "sess-1"), /handle rejected|missing/i);
});

test("object store rejects persisted byte or metadata tampering", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-objects-tamper-"));
  const original = new ObjectStore(dir);
  const { handle } = original.put(Buffer.from("trusted-office"), { kind: "office", mime: "application/test" });
  original.bind(handle, { sessionId: "sess-1", routeId: "route-1" });
  writeFileSync(join(dir, `${handle}.bin`), "tampered-office");
  assert.throws(() => new ObjectStore(dir).get(handle, "sess-1"), /identity mismatch|STORE_CORRUPT/i);

  const restored = Buffer.from("trusted-office");
  writeFileSync(join(dir, `${handle}.bin`), restored);
  const meta = JSON.parse(readFileSync(join(dir, `${handle}.json`), "utf8")) as Record<string, unknown>;
  writeFileSync(join(dir, `${handle}.json`), JSON.stringify({ ...meta, size: 1 }));
  assert.throws(() => new ObjectStore(dir).get(handle, "sess-1"), /metadata mismatch|STORE_CORRUPT/i);
});

test("attachDownloadedMedia requires saveImage for images", async () => {
  const store = new MediaStore();
  await assert.rejects(
    () =>
      attachDownloadedMedia({
        store,
        bytes: PNG,
        base: {
          kind: "image",
          source: "weixin",
          sourceMessageId: "m",
          sourceResourceId: "r",
          mime: "image/png",
        },
      }),
    /saveImage|DSH_UNAVAILABLE/,
  );
  const env = await attachDownloadedMedia({
    store,
    bytes: PNG,
    base: {
      kind: "image",
      source: "weixin",
      sourceMessageId: "m",
      sourceResourceId: "r",
      mime: "image/png",
    },
    imageAdmission: {
      async saveImage(input) {
        return { attachmentId: "att-x", mediaType: input.mediaType, bytes: input.data.byteLength, width: 1, height: 1 };
      },
    },
  });
  assert.equal(env.officialImage?.attachmentId, "att-x");
  assert.match(userFacingMediaPrompt(env), /图片/);
});
