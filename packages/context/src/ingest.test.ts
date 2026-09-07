import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { zipSync } from "fflate";
import { extractText, MAX_EXPANDED_BYTES } from "./ingest.js";

test("context rejects compressed PDF expansion without falling back to compressed text", () => {
  const payload = deflateSync(Buffer.alloc(MAX_EXPANDED_BYTES + 1, 65));
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\nstream\n"), payload, Buffer.from("\nendstream")]);
  const original = Buffer.from(pdf);
  assert.throws(() => extractText("large.pdf", pdf), /expansion limit/);
  assert.deepEqual(pdf, original);
});

test("context bounds OOXML expansion even if the directory understates its size", () => {
  const archive = Buffer.from(zipSync({ "word/document.xml": Buffer.alloc(MAX_EXPANDED_BYTES + 1, 65) }));
  const directory = archive.indexOf(Buffer.from("PK\x01\x02"));
  archive.writeUInt32LE(1, directory + 24);
  const original = Buffer.from(archive);
  assert.throws(() => extractText("large.docx", archive), /larger than|expansion limit/i);
  assert.deepEqual(archive, original);
});

test("context continues extracting bounded compressed PDF and OOXML", () => {
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\nstream\n"), deflateSync(Buffer.from("(Readable PDF text)")), Buffer.from("\nendstream")]);
  assert.equal(extractText("small.pdf", pdf), "Readable PDF text");
  const archive = Buffer.from(zipSync({ "word/document.xml": Buffer.from("<w:p>Readable document</w:p>") }));
  assert.equal(extractText("small.docx", archive), "Readable document");
  assert.throws(() => extractText("broken.docx", Buffer.from("PK\x05\x06")), /central directory/);
});
