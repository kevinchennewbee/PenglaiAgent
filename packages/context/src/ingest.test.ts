import assert from "node:assert/strict";
import test from "node:test";
import { extractText } from "./ingest.js";

test("context indexes bounded text formats", () => {
  assert.equal(extractText("notes.md", Buffer.from("Readable text")), "Readable text");
});

test("context rejects PDF and office document formats excluded from 0.6.3", () => {
  for (const name of ["document.pdf", "document.docx", "sheet.xlsx", "deck.pptx"]) {
    assert.throws(() => extractText(name, Buffer.from("excluded")), /unsupported context type/);
  }
});
