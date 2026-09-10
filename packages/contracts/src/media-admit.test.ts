import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  MediaStore,
  ObjectStore,
  attachDownloadedMedia,
  imageMediaTypeFromBytes,
  isDiagnosticMediaCaption,
  officialFileDigest,
  readExactRegularFile,
  sanitizeOfficialFileName,
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

test("exact regular-file reader bounds bytes and rejects symlinks", (context) => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-exact-file-"));
  const file = join(dir, "entry.json");
  writeFileSync(file, "trusted");
  assert.equal(readExactRegularFile(file, 7).toString("utf8"), "trusted");
  assert.throws(() => readExactRegularFile(file, 6), /byte limit|SECURITY_POLICY/i);

  const link = join(dir, "entry-link.json");
  try {
    symlinkSync(file, link);
  } catch (error) {
    if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    context.skip("Windows account cannot create file symlinks without Developer Mode or elevation");
    return;
  }
  assert.throws(
    () => readExactRegularFile(link, 7),
    /ELOOP|regular file|symlink source|STORE_CORRUPT|SECURITY_POLICY/i,
  );
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

test("PDF and DOCX admit through official saveFile and keep office handles", async () => {
  const store = new MediaStore();
  const objects = new ObjectStore();
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const env = await attachDownloadedMedia({
    store,
    bytes: pdf,
    base: {
      kind: "pdf",
      source: "weixin",
      sourceMessageId: "m",
      sourceResourceId: "r",
      mime: "application/pdf",
      filename: "C:\\\\Users\\\\x\\\\report.pdf",
    },
    objectStore: objects,
    fileAdmission: {
      async saveFile(input) {
        return {
          attachmentId: `sha256:${officialFileDigest(Buffer.from(input.data))}`,
          name: sanitizeOfficialFileName(input.name),
          bytes: input.data.byteLength,
        };
      },
    },
  });
  assert.equal(env.officialImage, undefined);
  assert.equal(env.officialFile?.name, "report.pdf");
  assert.equal(env.officialFile?.bytes, pdf.length);
  assert.match(env.officialFile?.attachmentId ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.ok(env.officeHandle);
  assert.match(userFacingMediaPrompt(env), /文档/);
});

test("neutral binary files require an official FileBlock receipt and reject a missing or tampered receipt", async () => {
  const store = new MediaStore();
  const bytes = Buffer.from("hello-bin");
  await assert.rejects(
    () =>
      attachDownloadedMedia({
        store,
        bytes,
        base: {
          kind: "file",
          source: "feishu",
          sourceMessageId: "m",
          sourceResourceId: "r",
          mime: "application/octet-stream",
          filename: "a.bin",
        },
      }),
    /saveFile|DSH_UNAVAILABLE/,
  );
  await assert.rejects(
    () =>
      attachDownloadedMedia({
        store,
        bytes,
        base: {
          kind: "file",
          source: "feishu",
          sourceMessageId: "m2",
          sourceResourceId: "r2",
          mime: "application/octet-stream",
          filename: "a.bin",
        },
        fileAdmission: {
          async saveFile() {
            return { attachmentId: "sha256:" + "0".repeat(64), name: "a.bin", bytes: bytes.length };
          },
        },
      }),
    /official file receipt rejected|SECURITY_POLICY/,
  );
  const env = await attachDownloadedMedia({
    store,
    bytes,
    base: {
      kind: "file",
      source: "feishu",
      sourceMessageId: "m3",
      sourceResourceId: "r3",
      mime: "application/octet-stream",
      filename: "a.bin",
    },
    fileAdmission: {
      async saveFile(input) {
        return {
          attachmentId: `sha256:${createHash("sha256").update(input.data).digest("hex")}`,
          name: "a.bin",
          bytes: input.data.byteLength,
        };
      },
    },
  });
  assert.equal(env.officialFile?.name, "a.bin");
  assert.equal(env.officeHandle, undefined);
});
