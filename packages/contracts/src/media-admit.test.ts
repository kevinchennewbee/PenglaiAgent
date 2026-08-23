import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
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
