import assert from "node:assert/strict";
import test from "node:test";
import { commit, createDocument, createOfficeService, edit, inspect } from "./service.js";

const formats = ["docx", "xlsx", "pptx", "pdf"] as const;

test("office create/inspect/edit/commit round-trips four formats", () => {
  const svc = createOfficeService();
  assert.equal(svc.name, "@penglai/office");
  for (const format of formats) {
    const created = createDocument(format, `hello ${format}`);
    const seen = inspect(created.bytes);
    assert.equal(seen.format, format);
    assert.match(seen.text, new RegExp(format));
    const patched = edit(created.bytes, "世界");
    const after = inspect(commit(patched));
    assert.match(after.text, /世界/);
    assert.match(after.text, new RegExp(format));
  }
});

test("office rejects secrets and unknown bytes", () => {
  assert.throws(() => createDocument("docx", "api_key=sk-test"), /secret/);
  assert.throws(() => inspect(Buffer.from("not-a-document")), /unsupported/);
});
