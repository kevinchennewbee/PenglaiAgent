import { PenglaiError, RELEASE } from "@penglai/contracts";
import { readZip } from "./zip.js";
import type { OfficeFormat } from "./formats.js";
import { assertAuthorizedBytes, assertWorkspace } from "./authorization.js";
import { cancelJob, createJob, digestBytes, discardJob, getJob, setJobState, type OfficeJobRecord } from "./jobs.js";
import { createDocx, editDocx, inspectDocx } from "./adapters/docx.js";
import { createXlsx, editXlsx, inspectXlsx, verifyXlsx } from "./adapters/xlsx.js";
import { createPptx, editPptx, inspectPptx } from "./adapters/pptx.js";
import { createPdf, editPdf, inspectPdf, mergePdf, rotatePdf } from "./adapters/pdf.js";
import { OFFICE_TEMPLATES, templateById } from "./templates/catalog.js";
import { previewJob } from "./preview.js";
import { diffJob } from "./diff.js";

export type { OfficeFormat } from "./formats.js";

export interface DocumentInventory {
  format: OfficeFormat;
  text: string;
  parts: string[];
}

export interface OfficeJob {
  id: string;
  format: OfficeFormat;
  bytes: Buffer;
  text: string;
}

const SECRET = /api[_-]?key|password|private key/i;

function requireSafe(text: string): void {
  if (SECRET.test(text)) throw new PenglaiError("SECURITY_POLICY", "office secret rejection");
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

export async function inspect(bytes: Buffer): Promise<DocumentInventory> {
  assertAuthorizedBytes(bytes);
  const format = detect(bytes);
  if (format === "docx") return { format, ...(await inspectDocx(bytes)) };
  if (format === "xlsx") return { format, ...(await inspectXlsx(bytes)) };
  if (format === "pptx") return { format, ...(await inspectPptx(bytes)) };
  return { format, ...(await inspectPdf(bytes)) };
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
  const seen = await inspect(bytes);
  const job = createJob(format, bytes, seen.text);
  return { id: job.id, format, bytes, text: seen.text };
}

export async function edit(bytes: Buffer, replacement: string): Promise<OfficeJob> {
  requireSafe(replacement);
  assertAuthorizedBytes(bytes);
  const format = detect(bytes);
  const before = digestBytes(bytes);
  const next =
    format === "docx"
      ? editDocx(bytes, replacement)
      : format === "xlsx"
        ? await editXlsx(bytes, replacement)
        : format === "pptx"
          ? editPptx(bytes, replacement)
          : await editPdf(bytes, replacement);
  const seen = await inspect(next);
  const job = createJob(format, next, seen.text, undefined, before);
  return { id: job.id, format, bytes: next, text: seen.text };
}

export function commit(job: OfficeJob): Buffer {
  return Buffer.from(job.bytes);
}

function jobBytes(job: OfficeJob): Buffer {
  return Buffer.from(job.bytes);
}

export function createOfficeService() {
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
      return previewJob(getJob(jobId));
    },
    async diff(jobId: string) {
      return diffJob(getJob(jobId));
    },
    async verify(jobId: string) {
      const job = getJob(jobId);
      if (job.format === "xlsx") await verifyXlsx(job.bytes);
      setJobState(jobId, "VERIFIED");
      return { ok: true, format: job.format, digest: job.digest };
    },
    commit(job: OfficeJob | string, receipt?: string) {
      if (typeof job === "string") {
        if (!receipt) throw new PenglaiError("SECURITY_POLICY", "office commit requires owner receipt");
        const record = getJob(job);
        record.state = "COMMITTED";
        return Buffer.from(record.bytes);
      }
      return jobBytes(job);
    },
    async discard(jobId: string, receipt: string) {
      if (!receipt) throw new PenglaiError("SECURITY_POLICY", "office discard requires owner receipt");
      discardJob(jobId);
    },
    async export(jobId: string, _target: OfficeFormat, receipt: string) {
      if (!receipt) throw new PenglaiError("SECURITY_POLICY", "office export requires owner receipt");
      const job = getJob(jobId);
      return { bytes: Buffer.from(job.bytes), format: job.format, filename: `penglai.${job.format}` };
    },
    async cancel(jobId: string) {
      cancelJob(jobId);
    },
    async rotate(bytes: Buffer) {
      return rotatePdf(bytes);
    },
    async merge(left: Buffer, right: Buffer) {
      return mergePdf(left, right);
    },
    templates() {
      return OFFICE_TEMPLATES.map((row) => ({ id: row.id, format: row.format, title: row.title, license: row.license }));
    },
    assertWorkspace,
    async health() {
      return { state: "active" as const, formats: ["docx", "xlsx", "pptx", "pdf"] as const, templates: OFFICE_TEMPLATES.length };
    },
    status() {
      return { state: "active", formats: ["docx", "xlsx", "pptx", "pdf"] as const };
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
