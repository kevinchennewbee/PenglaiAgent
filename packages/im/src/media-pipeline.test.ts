import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyMedia, MediaStore, mediaCaption } from "@penglai/contracts";
import { parseOfficialInbound, parseInbound } from "@penglai/channel-weixin";
import { parseFeishuEvent, parseOfficialReceiveWithMedia } from "@penglai/channel-feishu";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const DOCX = Buffer.from("PK\u0003\u0004word/document.xml", "binary");
const WAV = Buffer.from("RIFF    WAVEfmt ");

test("weixin and feishu parse image/file without placeholder text", () => {
  const wxImage = parseOfficialInbound(
    { message_type: 1, from_user_id: "u", item_list: [{ type: 2, msg_id: "img1", image_item: { media: { encrypt_query_param: "imgq" } } }] },
    "a",
  );
  assert.equal("reject" in wxImage, false);
  if (!("reject" in wxImage)) {
    assert.equal(wxImage.bodyKind, "media");
    assert.equal(wxImage.media?.kind, "image");
    assert.notEqual(wxImage.text, "[image]");
  }
  const wxFile = parseOfficialInbound(
    { message_type: 1, from_user_id: "u", item_list: [{ type: 4, msg_id: "f1", file_item: { file_name: "note.docx", media: { encrypt_query_param: "fileq" } } }] },
    "a",
  );
  assert.equal("reject" in wxFile, false);
  if (!("reject" in wxFile)) {
    assert.equal(wxFile.media?.kind, "office");
    assert.notEqual(wxFile.text, "[file]");
  }
  const fsImage = parseFeishuEvent({ chatType: "p2p", messageType: "image", messageId: "2" });
  assert.equal("reject" in fsImage, false);
  if (!("reject" in fsImage)) {
    assert.equal(fsImage.bodyKind, "media");
    assert.notEqual(fsImage.text, "[image]");
  }
  const fsFile = parseOfficialReceiveWithMedia({
    event: {
      message: {
        message_id: "om_file",
        chat_type: "p2p",
        message_type: "file",
        content: JSON.stringify({ file_key: "file_1", file_name: "sheet.xlsx" }),
      },
      sender: { sender_id: { open_id: "ou_1" } },
    },
  });
  assert.equal("reject" in fsFile.parsed, false);
  if (!("reject" in fsFile.parsed)) {
    assert.equal(fsFile.parsed.bodyKind, "media");
    assert.equal(fsFile.file?.fileKey, "file_1");
    assert.notEqual(fsFile.parsed.text, "[file]");
  }
  const inbound = parseInbound(
    { messageId: "3", fromUserId: "u", chatType: "private", itemType: "file", file: { file_name: "a.pdf", media: { encrypt_query_param: "p" } } },
    "a",
  );
  assert.equal("reject" in inbound, false);
  if (!("reject" in inbound)) assert.equal(inbound.media?.kind, "pdf");
});

test("media store persists bytes under an app-private root", () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-media-"));
  const store = new MediaStore(dir);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const env = store.put(png, {
    kind: "image",
    source: "weixin",
    sourceMessageId: "m1",
    sourceResourceId: "r1",
    mime: "image/png",
    filename: "a.png",
  });
  const disk = new MediaStore(dir);
  assert.equal(disk.get(env.opaqueHandle).equals(png), true);
});

test("media store classifies the shared fixture matrix", () => {
  const store = new MediaStore();
  const cases = [
    { bytes: PNG, filename: "a.png", kind: "image" as const },
    { bytes: WAV, filename: "a.wav", mime: "audio/wav", kind: "audio" as const },
    { bytes: DOCX, filename: "a.docx", kind: "office" as const },
    { bytes: PDF, filename: "a.pdf", kind: "pdf" as const },
    { bytes: Buffer.from("hello"), filename: "a.bin", kind: "file" as const },
  ];
  for (const row of cases) {
    assert.equal(classifyMedia(row), row.kind);
    const env = store.put(row.bytes, {
      kind: row.kind,
      source: "weixin",
      sourceMessageId: row.filename,
      sourceResourceId: row.filename,
      mime: "application/octet-stream",
      filename: row.filename,
    });
    assert.equal(env.size, row.bytes.length);
    assert.equal(store.get(env.opaqueHandle).equals(row.bytes), true);
    assert.match(mediaCaption(env), /penglai-media/);
    assert.doesNotMatch(mediaCaption(env), /\[image\]|\[file\]/);
  }
});
