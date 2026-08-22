import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PenglaiError, RELEASE } from "@penglai/contracts";
import { readZip } from "./zip.js";
import type { OfficeFormat } from "./formats.js";
import { assertAuthorizedBytes, assertWorkspace } from "./authorization.js";
import {
  cancelJob,
  createJob,
  digestBytes,
  discardJob,
  getJob,
  setJobState,
  type OfficeJobRecord,
} from "./jobs.js";
import { createDocx, editDocx, inspectDocx } from "./adapters/docx.js";
import { createXlsx, editXlsx, inspectXlsx, verifyXlsx } from "./adapters/xlsx.js";
import { createPptx, editPptx, inspectPptx } from "./adapters/pptx.js";
import { createPdf, editPdf, inspectPdf, mergePdf, rotatePdf } from "./adapters/pdf.js";
import { OFFICE_TEMPLATES, templateById } from "./templates/catalog.js";
import { previewJob } from "./preview.js";
import { diffJob } from "./diff.js";
import { assertOperationForFormat, OFFICE_LIMITS, type OfficeOperation } from "./operations.js";
import { createReceiptSecret, issueOfficeReceipt, verifyOfficeReceipt } from "./receipt.js";
import { assertPathInWorkspace, atomicCommitFile } from "./transaction.js";

export type { OfficeFormat } from "./formats.js";
export type { OfficeOperation } from "./operations.js";

export interface DocumentInventory {
  format: OfficeFormat;
  text: string;
  parts: string[];
  warnings: string[];
}

export interface OfficeJob {
  id: string;
  format: OfficeFormat;
  bytes: Buffer;
  text: string;
  parts: string[];
  warnings: string[];
  digest: string;
}

const SECRET = /api[_-]?key|password|private key/i;
const RECEIPT_TTL_MS = 15 * 60 * 1000;

function requireSafe(text: string): void {
  if (SECRET.test(text)) throw new PenglaiError("SECURITY_POLICY", "office secret rejection");
}

function toPublic(job: OfficeJobRecord): OfficeJob {
  return {
    id: job.id,
    format: job.format,
    bytes: Buffer.from(job.bytes),
    text: job.text,
    parts: job.parts,
    warnings: job.warnings,
    digest: job.digest,
  };
}

export function detect(bytes: Buffer): OfficeFormat {
  if (bytes.subarray(0, 4).toString("binary") === "%PDF") return "pdf";
  if (bytes.subarray(0, 2).toString("binary") === "PK") {
    const names = readZip(bytes).map((entry) => entry.name);
    if (names.some((name) => name.startsWith("word/"))) return "docx";
    if (names.some((name) => name.startsWith("xl/"))) return "xlsx";
    if (names.some((name) => name.startsWith("ppt/"))) return "pptx";
  }
  throw new PenglaiError("INVALID_INPUT", "unsupported office format");
}

async function inspectRaw(bytes: Buffer): Promise<DocumentInventory> {
  assertAuthorizedBytes(bytes);
  const format = detect(bytes);
  if (format === "docx") {
    const seen = await inspectDocx(bytes);
    return { format, text: seen.text, parts: seen.parts, warnings: [OFFICE_LIMITS.docx] };
  }
  if (format === "xlsx") {
    const seen = await inspectXlsx(bytes);
    return { format, text: seen.text, parts: seen.parts, warnings: [OFFICE_LIMITS.xlsx] };
  }
  if (format === "pptx") {
    const seen = await inspectPptx(bytes);
    return { format, text: seen.text, parts: seen.parts, warnings: [OFFICE_LIMITS.pptx] };
  }
  const seen = await inspectPdf(bytes);
  return { format, text: seen.text, parts: seen.parts, warnings: [OFFICE_LIMITS.pdf] };
}

async function applyOperation(bytes: Buffer, format: OfficeFormat, op: OfficeOperation): Promise<Buffer> {
  assertOperationForFormat(format, op);
  if (op.kind === "docx.replaceParagraph") return editDocx(bytes, op);
  if (op.kind === "xlsx.setCell") return editXlsx(bytes, op);
  if (op.kind === "pptx.replaceSlideText") return editPptx(bytes, op);
  if (op.kind === "pdf.watermark") return editPdf(bytes, { text: op.text });
  return rotatePdf(bytes, op.degrees);
}

export async function inspect(bytes: Buffer): Promise<DocumentInventory> {
  return inspectRaw(bytes);
}

export async function createDocument(format: OfficeFormat, text: string): Promise<OfficeJob> {
  requireSafe(text);
  const bytes =
    format === "docx"
      ? await createDocx(text)
      : format === "xlsx"
        ? await createXlsx(text)
        : format === "pptx"
          ? await createPptx(text)
          : await createPdf(text);
  const seen = await inspectRaw(bytes);
  const job = createJob({ format, bytes, text: seen.text, parts: seen.parts, warnings: seen.warnings });
  return toPublic(job);
}

export async function edit(bytes: Buffer, op: OfficeOperation): Promise<OfficeJob> {
  const text = "text" in op ? String(op.text) : "value" in op ? String(op.value) : "";
  if (text) requireSafe(text);
  assertAuthorizedBytes(bytes);
  const format = detect(bytes);
  const before = await inspectRaw(bytes);
  const next = await applyOperation(bytes, format, op);
  const seen = await inspectRaw(next);
  const job = createJob({
    format,
    bytes: next,
    text: seen.text,
    parts: seen.parts,
    warnings: seen.warnings,
    ops: [op],
  });
  job.sourceBytes = Buffer.from(bytes);
  job.sourceDigest = digestBytes(bytes);
  job.bytes = next;
  job.digest = digestBytes(next);
  job.stagedBytes = Buffer.from(next);
  setJobState(job.id, "PLAN_READY", before.text.slice(0, 80));
  setJobState(job.id, "PREVIEW_READY", op.kind);
  return toPublic(job);
}

export function commit(job: OfficeJob): Buffer {
  return Buffer.from(job.bytes);
}

export function createOfficeService() {
  const secret = createReceiptSecret();
  return {
    name: "@penglai/office",
    version: RELEASE,
    inspect,
    create: createDocument,
    async createFromTemplate(id: string, workspaceId?: string) {
      const template = templateById(id);
      const created = await createDocument(template.format, template.body);
      if (workspaceId) getJob(created.id).workspaceId = workspaceId;
      return created;
    },
    edit,
    async preview(jobId: string) {
      const job = getJob(jobId);
      if (job.state === "INSPECTED" || job.state === "PLAN_READY") setJobState(jobId, "PREVIEW_READY", "preview");
      return previewJob(job);
    },
    async diff(jobId: string) {
      return diffJob(getJob(jobId));
    },
    approve(jobId: string) {
      const job = getJob(jobId);
      if (job.state !== "PREVIEW_READY" && job.state !== "PLAN_READY" && job.state !== "INSPECTED") {
        throw new PenglaiError("SECURITY_POLICY", "office job is not ready for approval");
      }
      const receipt = issueOfficeReceipt(secret, {
        jobId: job.id,
        sourceDigest: job.sourceDigest,
        opsDigest: job.opsDigest,
        exp: Date.now() + RECEIPT_TTL_MS,
        ...(job.workspaceId ? { workspaceId: job.workspaceId } : {}),
      });
      job.receipt = receipt;
      setJobState(jobId, "OWNER_APPROVED", "hmac");
      return receipt;
    },
    async verify(jobId: string) {
      const job = getJob(jobId);
      if (job.format === "xlsx") await verifyXlsx(job.bytes);
      setJobState(jobId, "VERIFIED");
      return { ok: true, format: job.format, digest: job.digest };
    },
    commit(job: OfficeJob | string, receipt?: string) {
      if (typeof job !== "string") return Buffer.from(job.bytes);
      if (!receipt) throw new PenglaiError("SECURITY_POLICY", "office commit requires owner receipt");
      const record = getJob(job);
      verifyOfficeReceipt(secret, receipt, {
        jobId: record.id,
        sourceDigest: record.sourceDigest,
        opsDigest: record.opsDigest,
        ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
      });
      record.stagedBytes = Buffer.from(record.bytes);
      setJobState(job, "STAGED", "bytes");
      record.resultDigest = digestBytes(record.bytes);
      record.backupBytes = Buffer.from(record.sourceBytes);
      setJobState(job, "COMMITTED", "in-memory");
      setJobState(job, "UNDO_READY", "backup retained");
      return Buffer.from(record.bytes);
    },
    commitToPath(jobId: string, receipt: string, destPath: string, workspaceRoot: string) {
      const record = getJob(jobId);
      verifyOfficeReceipt(secret, receipt, {
        jobId: record.id,
        sourceDigest: record.sourceDigest,
        opsDigest: record.opsDigest,
        ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
      });
      const dest = assertPathInWorkspace(destPath, workspaceRoot);
      const backup = join(tmpdir(), `penglai-office-${record.id}.bak`);
      setJobState(jobId, "STAGED", dest);
      const result = atomicCommitFile(dest, record.bytes, backup);
      record.destPath = dest;
      record.resultDigest = result.destDigest;
      record.backupBytes = existsSync(backup) ? readFileSync(backup) : Buffer.from(record.sourceBytes);
      setJobState(jobId, "COMMITTED", result.destDigest);
      setJobState(jobId, "UNDO_READY", backup);
      return { dest, digest: result.destDigest, backup };
    },
    undo(jobId: string, receipt: string) {
      const record = getJob(jobId);
      verifyOfficeReceipt(secret, receipt, {
        jobId: record.id,
        sourceDigest: record.sourceDigest,
        opsDigest: record.opsDigest,
        ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
      });
      if (record.state !== "UNDO_READY" && record.state !== "COMMITTED") {
        throw new PenglaiError("SECURITY_POLICY", "office job is not undoable");
      }
      if (record.destPath && record.resultDigest) {
        if (!existsSync(record.destPath)) throw new PenglaiError("INVALID_INPUT", "office undo target missing");
        const current = digestBytes(readFileSync(record.destPath));
        if (current !== record.resultDigest) {
          throw new PenglaiError("SECURITY_POLICY", "office undo refused because the file changed after commit");
        }
        if (record.backupBytes) {
          const backup = join(tmpdir(), `penglai-office-${record.id}.undo`);
          atomicCommitFile(record.destPath, record.backupBytes, backup);
        }
      }
      record.bytes = Buffer.from(record.sourceBytes);
      record.digest = record.sourceDigest;
      setJobState(jobId, "UNDONE", "restored source digest");
      return Buffer.from(record.bytes);
    },
    async discard(jobId: string, receipt: string) {
      if (!receipt) throw new PenglaiError("SECURITY_POLICY", "office discard requires owner receipt");
      const record = getJob(jobId);
      verifyOfficeReceipt(secret, receipt, {
        jobId: record.id,
        sourceDigest: record.sourceDigest,
        opsDigest: record.opsDigest,
        ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
      });
      discardJob(jobId);
    },
    async export(jobId: string, _target: OfficeFormat, receipt: string) {
      if (!receipt) throw new PenglaiError("SECURITY_POLICY", "office export requires owner receipt");
      const job = getJob(jobId);
      verifyOfficeReceipt(secret, receipt, {
        jobId: job.id,
        sourceDigest: job.sourceDigest,
        opsDigest: job.opsDigest,
        ...(job.workspaceId ? { workspaceId: job.workspaceId } : {}),
      });
      return { bytes: Buffer.from(job.bytes), format: job.format, filename: `penglai.${job.format}`, digest: job.digest };
    },
    async cancel(jobId: string) {
      cancelJob(jobId);
    },
    async rotate(bytes: Buffer) {
      return rotatePdf(bytes, 90);
    },
    async merge(left: Buffer, right: Buffer) {
      return mergePdf(left, right);
    },
    templates() {
      return OFFICE_TEMPLATES.map((row) => ({ id: row.id, format: row.format, title: row.title, license: row.license }));
    },
    limits() {
      return OFFICE_LIMITS;
    },
    assertWorkspace,
    async health() {
      return { state: "active" as const, formats: ["docx", "xlsx", "pptx", "pdf"] as const, templates: OFFICE_TEMPLATES.length, limits: OFFICE_LIMITS };
    },
    status() {
      return { state: "active", formats: ["docx", "xlsx", "pptx", "pdf"] as const, limits: OFFICE_LIMITS };
    },
    async close() {
      return { workers: 0, sockets: 0, timers: 0, remotes: 0, db: 0, modelSessions: 0, audioHandles: 0 };
    },
    resourceSnapshot() {
      return {
        workers: 0,
        sockets: 0,
        timers: 0,
        remotes: 0,
        db: 0,
        modelSessions: 0,
        audioHandles: 0,
      };
    },
  };
}

export type OfficeService = ReturnType<typeof createOfficeService>;
