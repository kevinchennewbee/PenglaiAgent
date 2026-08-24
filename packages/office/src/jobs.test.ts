import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import {
  OfficeJobStore,
  assertPreviewMatchesResult,
  digestBytes,
  freezePreviewDigest,
  officeBackupName,
} from "./jobs.js";
import { OwnerApprovalBroker } from "@penglai/runtime";
import { createDocument, createOfficeService, edit } from "./service.js";

function liveOffice(userData: string) {
  const owner = new OwnerApprovalBroker(userData, { dialog: async () => "approved" });
  return createOfficeService({ userData, owner });
}

test("R56-OFF-003 job store enforces concurrent, retained, cancel, TTL, and wipe", () => {
  const store = new OfficeJobStore({ maxConcurrent: 2, maxRetained: 3, ttlMs: 30 * 60 * 1000 });
  const first = store.create({ format: "docx", bytes: Buffer.from("one"), text: "t" });
  store.create({ format: "docx", bytes: Buffer.from("two"), text: "t" });
  assert.equal(store.stats().inFlight, 2);
  assert.throws(
    () => store.create({ format: "docx", bytes: Buffer.from("three"), text: "t" }),
    (error: unknown) => error instanceof PenglaiError && error.message === "OFFICE_JOB_CONCURRENT_LIMIT",
  );
  const bytes = first.bytes;
  store.discard(first.id);
  assert.equal(bytes.every((n) => n === 0), true);
  assert.throws(() => store.get(first.id), /not found/);
  const third = store.create({ format: "docx", bytes: Buffer.from("after-discard"), text: "t" });
  store.cancel(third.id);
  assert.throws(() => store.get(third.id), /not found/);
  const aged = store.create({ format: "docx", bytes: Buffer.from("ttl"), text: "t" });
  aged.events[0]!.at = Date.now() - 30 * 60 * 1000 - 10;
  assert.throws(() => store.get(aged.id), /not found/);
});

test("R56-OFF-003 completed jobs are evicted before in-flight work is refused", () => {
  const store = new OfficeJobStore({ maxConcurrent: 2, maxRetained: 2, ttlMs: 30 * 60 * 1000 });
  const finished = store.create({ format: "pdf", bytes: Buffer.from("done"), text: "t" });
  store.setState(finished.id, "COMMITTED", "retain");
  store.create({ format: "pdf", bytes: Buffer.from("live-1"), text: "t" });
  store.create({ format: "pdf", bytes: Buffer.from("live-2"), text: "t" });
  assert.equal(store.stats().inFlight, 2);
  assert.throws(() => store.get(finished.id), /not found/);
});

test("R56-OFF-004 backup names bind operation, revision, and digest and never collide", () => {
  const id = "office-11111111-1111-4111-8111-111111111111";
  const first = officeBackupName({ operationId: id, revision: 1, digest: "ab".repeat(32), kind: "bak" });
  const second = officeBackupName({ operationId: id, revision: 2, digest: "ab".repeat(32), kind: "bak" });
  const undo = officeBackupName({ operationId: id, revision: 3, digest: "cd".repeat(32), kind: "undo" });
  assert.match(first, /^penglai-office-office-11111111-1111-4111-8111-111111111111-r1-abababababababab\.bak$/);
  assert.notEqual(first, second);
  assert.match(undo, /\.undo$/);
  assert.throws(
    () => officeBackupName({ operationId: "office-1", revision: 1, digest: "ab".repeat(32), kind: "bak" }),
    /operation id/,
  );
});

test("R56-OFF-004 retry and undo keep previous backup files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-office-bak-"));
  const svc = liveOffice(join(dir, "user-data"));
  const dest = join(dir, "note.docx");
  const created = await createDocument("docx", "original-docx");
  writeFileSync(dest, created.bytes);
  const edited = await edit(created.bytes, { kind: "docx.replaceParagraph", paragraphIndex: 0, text: "revised-docx" });
  const receipt = await svc.approve(edited.id, "commit-to-path", dest);
  const first = svc.commitToPath(edited.id, receipt, dest, dir);
  const again = await svc.approve(edited.id, "commit-to-path", dest);
  const second = svc.commitToPath(edited.id, again, dest, dir);
  assert.notEqual(first.backup, second.backup);
  assert.equal(existsSync(first.backup), true);
  assert.equal(existsSync(second.backup), true);
  const undoReceipt = await svc.approve(edited.id, "undo");
  svc.undo(edited.id, undoReceipt);
  const backups = readdirSync(join(dir, "user-data", "office", "backups"));
  assert.ok(backups.some((name) => name.endsWith(".bak")));
  assert.ok(backups.some((name) => name.endsWith(".undo")));
  assert.equal(new Set(backups).size, backups.length);
});

test("R56-OFF-005 commit/export refuse bytes that no longer match the preview digest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-office-preview-"));
  const svc = liveOffice(join(dir, "user-data"));
  const created = await svc.create("docx", "preview-digest");
  await svc.preview(created.id);
  const job = svc.job(created.id);
  const previewed = job.previewResultDigest;
  freezePreviewDigest(job);
  assert.equal(job.previewResultDigest, previewed);
  job.bytes = Buffer.from("tampered-after-preview");
  const receipt = await svc.approve(created.id, "commit");
  assert.throws(
    () => svc.commit(created.id, receipt),
    (error: unknown) => error instanceof PenglaiError && error.message === "office preview digest mismatch",
  );
  assert.throws(() => assertPreviewMatchesResult(job), /mismatch/);
});

test("R56-OFF-005 export digest equals the previewed result bytes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-office-export-"));
  const svc = liveOffice(join(dir, "user-data"));
  const created = await svc.create("docx", "export-digest");
  const preview = await svc.preview(created.id);
  const receipt = await svc.approve(created.id, "export", "docx");
  const exported = await svc.export(created.id, "docx", receipt);
  assert.equal(exported.digest, preview[0]?.digest);
  assert.equal(exported.digest, digestBytes(exported.bytes));
});

test("R56-OFF-006 commit refuses a second destination after the proposal is bound", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-office-path-"));
  const svc = liveOffice(join(dir, "user-data"));
  const dest = join(dir, "first.docx");
  const other = join(dir, "other.docx");
  const created = await svc.create("docx", "bound-path");
  writeFileSync(dest, created.bytes);
  writeFileSync(other, created.bytes);
  const receipt = await svc.approve(created.id, "commit-to-path", dest);
  svc.commitToPath(created.id, receipt, dest, dir);
  const again = await svc.approve(created.id, "commit-to-path", other);
  assert.throws(() => svc.commitToPath(created.id, again, other, dir), /bound proposal|receipt/);
});
