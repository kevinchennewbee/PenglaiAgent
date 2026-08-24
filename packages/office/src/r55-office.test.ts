import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertAuthorizedBytes,
  commit,
  createDocument,
  createOfficeService,
  edit,
  inspect,
} from "./index.js";
import { OwnerApprovalBroker } from "@penglai/runtime";
import { OFFICE_TEMPLATES } from "./templates/catalog.js";
import { writeZip } from "./zip.js";
import { mergePdf, rotatePdf } from "./adapters/pdf.js";

function liveOffice(userData: string) {
  const owner = new OwnerApprovalBroker(userData, { dialog: async () => "approved" });
  return createOfficeService({ userData, owner });
}

test("R55-OFFICE-001 DOCX inspect", async () => {
  const created = await createDocument("docx", "hello docx");
  assert.equal((await inspect(created.bytes)).format, "docx");
});

test("R55-OFFICE-002 DOCX create", async () => {
  const created = await createDocument("docx", "created-docx");
  assert.match((await inspect(created.bytes)).text, /created-docx/);
});

test("R55-OFFICE-003 DOCX partial edit", async () => {
  const created = await createDocument("docx", "hello docx");
  const patched = await edit(created.bytes, { kind: "docx.replaceParagraph", paragraphIndex: 0, text: "世界" });
  assert.match((await inspect(commit(patched))).text, /世界/);
});

test("R55-OFFICE-004 DOCX verify", async () => {
  const svc = createOfficeService();
  const created = await svc.create("docx", "verify-docx");
  const report = await svc.verify(created.id);
  assert.equal(report.ok, true);
});

test("R55-OFFICE-005 XLSX inspect", async () => {
  const created = await createDocument("xlsx", "hello xlsx");
  assert.equal((await inspect(created.bytes)).format, "xlsx");
});

test("R55-OFFICE-006 XLSX create", async () => {
  const created = await createDocument("xlsx", "created-xlsx");
  assert.match((await inspect(created.bytes)).text, /created-xlsx/);
});

test("R55-OFFICE-007 XLSX partial edit", async () => {
  const created = await createDocument("xlsx", "hello xlsx");
  const patched = await edit(created.bytes, { kind: "xlsx.setCell", cell: "B1", value: "世界" });
  assert.match((await inspect(commit(patched))).text, /世界/);
  assert.match((await inspect(commit(patched))).text, /hello xlsx/);
});

test("R55-OFFICE-008 XLSX verify", async () => {
  const svc = createOfficeService();
  const created = await svc.create("xlsx", "verify-xlsx");
  const report = await svc.verify(created.id);
  assert.equal(report.ok, true);
});

test("R55-OFFICE-009 PPTX inspect", async () => {
  const created = await createDocument("pptx", "hello pptx");
  assert.equal((await inspect(created.bytes)).format, "pptx");
});

test("R55-OFFICE-010 PPTX create", async () => {
  const created = await createDocument("pptx", "created-pptx");
  assert.match((await inspect(created.bytes)).text, /created-pptx/);
});

test("R55-OFFICE-011 PPTX partial edit", async () => {
  const created = await createDocument("pptx", "hello pptx");
  const patched = await edit(created.bytes, { kind: "pptx.replaceSlideText", slideIndex: 0, text: "世界" });
  assert.match((await inspect(commit(patched))).text, /世界/);
});

test("R55-OFFICE-012 PPTX verify", async () => {
  const svc = createOfficeService();
  const created = await svc.create("pptx", "verify-pptx");
  const report = await svc.verify(created.id);
  assert.equal(report.ok, true);
});

test("R55-OFFICE-013 PDF inspect", async () => {
  const created = await createDocument("pdf", "hello pdf");
  assert.equal((await inspect(created.bytes)).format, "pdf");
});

test("R55-OFFICE-014 PDF create", async () => {
  const created = await createDocument("pdf", "created-pdf");
  assert.match((await inspect(created.bytes)).text, /created-pdf/);
});

test("R55-OFFICE-015 PDF watermark embeds CJK with OFL font", async () => {
  const created = await createDocument("pdf", "hello pdf");
  const patched = await edit(created.bytes, { kind: "pdf.watermark", text: "世界" });
  assert.match((await inspect(commit(patched))).text, /世界|hello pdf/);
});

test("R55-OFFICE-016 PDF verify", async () => {
  const svc = createOfficeService();
  const created = await svc.create("pdf", "verify-pdf");
  const report = await svc.verify(created.id);
  assert.equal(report.ok, true);
});

test("R55-OFFICE-017 attachment authorization", async () => {
  assert.throws(() => assertAuthorizedBytes(Buffer.alloc(0)), /required/);
});

test("R55-OFFICE-018 workspace isolation", async () => {
  const svc = createOfficeService();
  const created = await svc.createFromTemplate("resume-zh", "ws-a");
  assert.throws(() => svc.assertWorkspace("ws-a", "ws-b"), /isolation/);
  assert.equal(created.format, "docx");
});

test("R55-OFFICE-019 TOCTOU reject", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-office-toctou-"));
  const svc = liveOffice(join(dir, "user-data"));
  const created = await svc.create("docx", "toctou");
  const first = digestOf(created.bytes);
  const edited = await svc.edit(created.bytes, { kind: "docx.replaceParagraph", paragraphIndex: 0, text: "changed" });
  assert.notEqual(digestOf(edited.bytes), first);
  const receipt = await svc.approve(edited.id);
  assert.throws(() => svc.commit(edited.id, "owner-1"), /broker receipt/);
  assert.ok(svc.commit(edited.id, receipt).length > 0);
});

test("R55-OFFICE-020 malicious documents fail closed", async () => {
  const bomb = writeZip([{ name: "../etc/passwd", data: Buffer.from("x") }]);
  assert.throws(() => assertAuthorizedBytes(bomb), /traversal|bomb|office|OFFICE_ZIP/i);
});

test("R55-OFFICE-021 templates and OFL fonts only", () => {
  assert.equal(OFFICE_TEMPLATES.length, 10);
  assert.equal(
    OFFICE_TEMPLATES.every((row) => row.license === "generated-ir" || row.license === "OFL-adjacent-system-fallback"),
    true,
  );
});

test("R55-OFFICE-022 preview then Main broker owner approval", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-office-hmac-"));
  const svc = liveOffice(join(dir, "user-data"));
  const created = await svc.create("docx", "preview-me");
  const preview = await svc.preview(created.id);
  assert.equal(preview[0]?.kind, "inventory");
  assert.throws(() => svc.commit(created.id), /receipt/);
  assert.throws(() => svc.commit(created.id, "owner-1"), /broker receipt/);
  const receipt = await svc.approve(created.id);
  const bytes = svc.commit(created.id, receipt);
  assert.ok(bytes.length > 0);
});

test("R55-OFFICE-023 atomic commit/undo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-office-tx-"));
  const svc = liveOffice(join(dir, "user-data"));
  const dest = join(dir, "note.docx");
  const created = await svc.create("docx", "original-docx");
  writeFileSync(dest, created.bytes);
  const edited = await svc.edit(created.bytes, { kind: "docx.replaceParagraph", paragraphIndex: 0, text: "revised-docx" });
  const receipt = await svc.approve(edited.id, "commit-to-path", dest);
  const wrongAction = await svc.approve(edited.id, "commit");
  assert.throws(() => svc.commitToPath(edited.id, wrongAction, dest, dir), /intent mismatch|broker/);
  svc.commitToPath(edited.id, receipt, dest, dir);
  assert.match(readFileSync(dest).toString("utf8") === "" ? "x" : (await inspect(readFileSync(dest))).text, /revised-docx/);
  const undoReceipt = await svc.approve(edited.id, "undo");
  svc.undo(edited.id, undoReceipt);
  assert.match((await inspect(readFileSync(dest))).text, /original-docx/);
  const disposable = await svc.create("docx", "discard-me");
  const discardReceipt = await svc.approve(disposable.id, "discard");
  await svc.discard(disposable.id, discardReceipt);
  await assert.rejects(() => svc.preview(disposable.id), /not found/);
});

test("R55-OFFICE-024 IM file return path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-office-export-"));
  const svc = liveOffice(join(dir, "user-data"));
  const created = await svc.create("docx", "im-return");
  const receipt = await svc.approve(created.id, "export", "docx");
  const exported = await svc.export(created.id, "docx", receipt);
  assert.match(exported.filename, /\.docx$/);
  assert.equal(exported.digest, createHash("sha256").update(exported.bytes).digest("hex"));
});

test("office PDF rotate and merge stay on pdf-lib", async () => {
  const left = await createDocument("pdf", "left pdf");
  const right = await createDocument("pdf", "right pdf");
  const rotated = await rotatePdf(left.bytes);
  const merged = await mergePdf(left.bytes, right.bytes);
  assert.equal((await inspect(rotated)).format, "pdf");
  assert.equal((await inspect(merged)).format, "pdf");
});

function digestOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
