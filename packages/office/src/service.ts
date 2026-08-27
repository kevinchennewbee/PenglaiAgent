import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ObjectStore, PenglaiError, RELEASE } from "@penglai/contracts";
import { readZip } from "./zip.js";
import type { OfficeFormat } from "./formats.js";
import { assertAuthorizedBytes, assertWorkspace } from "./authorization.js";
import {
  assertPreviewMatchesResult,
  cancelJob,
  createJob,
  digestBytes,
  discardJob,
  freezePreviewDigest,
  getJob,
  nextOfficeBackupName,
  setJobState,
  type OfficeJobRecord,
} from "./jobs.js";
import { createDocx, createDocxFromSpec, editDocx, inspectDocx } from "./adapters/docx.js";
import { createXlsx, createXlsxFromSpec, editXlsx, inspectXlsx, verifyXlsx } from "./adapters/xlsx.js";
import { createPptx, createPptxFromSpec, editPptx, inspectPptx } from "./adapters/pptx.js";
import { createPdf, createPdfFromSpec, editPdf, inspectPdf, mergePdf, rotatePdf } from "./adapters/pdf.js";
import { OFFICE_TEMPLATES, templateById } from "./templates/catalog.js";
import { previewJob } from "./preview.js";
import { diffJob } from "./diff.js";
import { assertOperationForFormat, OFFICE_LIMITS, type OfficeOperation } from "./operations.js";
import { parseOfficeCreateSpec, type OfficeCreateSpec } from "./specs.js";
import { type OfficeReceiptAction } from "./receipt.js";
import { assertPathInWorkspace, atomicCommitFile } from "./transaction.js";
import type { ArtifactService } from "@penglai/artifacts";
import {
  consumeOfficeBrokerReceipt,
  isOwnerBrokerReceipt,
  officeOwnerAction,
  ownerBrokerActionId,
  proposeOfficeAction,
  type OfficeOwnerBrokerPort,
} from "./owner-adapter.js";

export type { OfficeFormat } from "./formats.js";
export type { OfficeOperation } from "./operations.js";
export type { OfficeCreateSpec } from "./specs.js";

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

export interface OfficeOutbound {
  sendFileToBoundRoute(input: {
    routeId: string;
    sessionId: string;
    workspaceId?: string;
    filename: string;
    bytes: Buffer;
    digest: string;
  }): Promise<{ channel: "weixin" | "feishu"; delivered: true }>;
}

const SECRET = /api[_-]?key|password|private key/i;

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
  if (op.kind.startsWith("docx.")) return editDocx(bytes, op as Extract<OfficeOperation, { kind: `docx.${string}` }>);
  if (op.kind.startsWith("xlsx.")) return editXlsx(bytes, op as Extract<OfficeOperation, { kind: `xlsx.${string}` }>);
  if (op.kind === "pptx.replaceSlideText") return editPptx(bytes, op);
  if (op.kind === "pdf.watermark") return editPdf(bytes, { text: op.text });
  if (op.kind === "pdf.rotate") return rotatePdf(bytes, op.degrees);
  throw new PenglaiError("INVALID_INPUT", "unsupported office operation");
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

export async function createStructuredDocument(input: unknown): Promise<OfficeJob> {
  const spec = parseOfficeCreateSpec(input);
  requireSafe(JSON.stringify(spec));
  const bytes = spec.format === "docx"
    ? await createDocxFromSpec(spec)
    : spec.format === "xlsx"
      ? await createXlsxFromSpec(spec)
      : spec.format === "pptx"
        ? await createPptxFromSpec(spec)
        : await createPdfFromSpec(spec);
  const seen = await inspectRaw(bytes);
  return toPublic(createJob({ format: spec.format, bytes, text: seen.text, parts: seen.parts, warnings: seen.warnings }));
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
  freezePreviewDigest(job);
  setJobState(job.id, "PLAN_READY", before.text.slice(0, 80));
  setJobState(job.id, "PREVIEW_READY", op.kind);
  return toPublic(job);
}

export function commit(job: OfficeJob): Buffer {
  return Buffer.from(job.bytes);
}

export function createOfficeService(opts?: {
  userData?: string;
  objects?: ObjectStore;
  outbound?: () => OfficeOutbound | undefined;
  owner?: OfficeOwnerBrokerPort;
  artifacts?: ArtifactService;
}) {
  const objects =
    opts?.objects ??
    new ObjectStore(opts?.userData ? join(opts.userData, "objects") : process.env.PENGLAI_USER_DATA ? join(process.env.PENGLAI_USER_DATA, "objects") : undefined);
  function receiptTarget(job: OfficeJobRecord, action: OfficeReceiptAction, requested = ""): string {
    if (action === "commit-to-path") {
      if (!requested) throw new PenglaiError("INVALID_INPUT", "office commit destination required");
      return requested;
    }
    if (action === "return-to-channel") {
      if (!job.routeId || !job.sessionId) throw new PenglaiError("INVALID_INPUT", "office job has no original IM route");
      return `${job.routeId}\n${job.sessionId}`;
    }
    if (action === "undo") return job.destPath ?? job.resultDigest ?? job.digest;
    if (action === "export") return requested || job.format;
    return requested;
  }
  function receiptResultDigest(job: OfficeJobRecord, action: OfficeReceiptAction): string {
    return action === "undo" ? job.sourceDigest : job.digest;
  }
  function receiptDestinationLabel(job: OfficeJobRecord, action: OfficeReceiptAction, requested = ""): string {
    if (action === "commit-to-path") return basename(receiptTarget(job, action, requested)).replace(/[\\/]/g, "");
    if (action === "export") return receiptTarget(job, action, requested);
    if (action === "return-to-channel") return "original IM conversation";
    if (action === "undo" && job.destPath) return basename(job.destPath).replace(/[\\/]/g, "");
    return "";
  }
  function consumeReceipt(job: OfficeJobRecord, action: OfficeReceiptAction, receipt: string, target = "") {
    if (!opts?.owner) throw new PenglaiError("SECURITY_POLICY", "office broker is not configured");
    if (!isOwnerBrokerReceipt(receipt)) {
      throw new PenglaiError("SECURITY_POLICY", "office broker receipt required");
    }
    const actionId = ownerBrokerActionId(receipt);
    const reserved = consumeOfficeBrokerReceipt(opts.owner, {
      receipt,
      actionId,
      action,
      jobId: job.id,
      sourceDigest: job.sourceDigest,
      ...(job.workspaceId ? { workspaceId: job.workspaceId } : {}),
      ...(job.sessionId ? { sessionId: job.sessionId } : {}),
      resultDigest: receiptResultDigest(job, action),
      ...(receiptDestinationLabel(job, action, target)
        ? { destinationLabel: receiptDestinationLabel(job, action, target) }
        : {}),
    });
    // A broker receipt is one-shot once reserved, regardless of whether the
    // following filesystem or delivery action succeeds. Never leave it on the
    // job where a later action (for example Undo after Commit) could reuse it.
    delete job.receipt;
    return () =>
      opts.owner?.completeApproval({
        actionId,
        reservationId: reserved.reservationId,
        resultDigest: receiptResultDigest(job, action),
      });
  }
  function ingestJobBytes(job: OfficeJobRecord, name: string, source: "office" | "generated" = "office") {
    if (!opts?.artifacts) return;
    const ref = opts.artifacts.ingestBytes(Buffer.from(job.bytes), {
      name,
      source,
      scope: job.workspaceId ? "workspace" : "turn",
      ...(job.workspaceId ? { workspaceId: job.workspaceId } : {}),
      ...(job.sessionId ? { sessionId: job.sessionId } : {}),
    });
    job.artifactId = ref.id;
  }
  return {
    name: "@penglai/office",
    version: RELEASE,
    inspect,
    objects,
    job(jobId: string) {
      return getJob(jobId);
    },
    create: createDocument,
    createStructured: createStructuredDocument,
    async inspectAttached(handle: string, sessionId: string) {
      const bytes = objects.get(handle, sessionId);
      const binding = objects.peek(handle).bind;
      const seen = await inspectRaw(bytes);
      const job = createJob({
        format: seen.format,
        bytes,
        text: seen.text,
        parts: seen.parts,
        warnings: seen.warnings,
        attachmentHandle: handle,
        sessionId,
        ...(binding?.workspaceId ? { workspaceId: binding.workspaceId } : {}),
        ...(binding?.routeId ? { routeId: binding.routeId } : {}),
      });
      ingestJobBytes(job, `attached.${seen.format}`);
      return { ...toPublic(job), handle };
    },
    async inspectWorkspaceFile(absPath: string, workspaceRoot: string, workspaceId: string) {
      const dest = assertPathInWorkspace(absPath, workspaceRoot);
      if (basename(dest) !== basename(absPath)) {
        throw new PenglaiError("SECURITY_POLICY", "office inspect filename escaped");
      }
      const bytes = readFileSync(dest);
      const seen = await inspectRaw(bytes);
      const job = createJob({
        format: seen.format,
        bytes,
        text: seen.text,
        parts: seen.parts,
        warnings: seen.warnings,
        workspaceId,
        sourcePath: dest,
      });
      if (opts?.artifacts) {
        const ref = opts.artifacts.ingestPath(dest, {
          name: basename(dest),
          source: "office",
          scope: "workspace",
          workspaceId,
        });
        job.artifactId = ref.id;
      }
      return toPublic(job);
    },
    async createFromTemplate(id: string, workspaceId?: string) {
      const template = templateById(id);
      const created = await createStructuredDocument(template.spec);
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
    accept(jobId: string) {
      const job = getJob(jobId);
      assertPreviewMatchesResult(job);
      if (!opts?.artifacts) throw new PenglaiError("DSH_UNAVAILABLE", "office Artifact service is not configured");
      if (job.resultArtifactId) return opts.artifacts.ref(job.resultArtifactId);
      const ref = opts.artifacts.ingestBytes(Buffer.from(job.bytes), {
        name: `penglai-office-${job.id.slice("office-".length, "office-".length + 8)}.${job.format}`,
        source: "generated",
        scope: "turn",
        ...(job.workspaceId ? { workspaceId: job.workspaceId } : {}),
        ...(job.sessionId ? { sessionId: job.sessionId } : {}),
        ...(job.parentArtifactId ? { parentArtifactId: job.parentArtifactId } : {}),
        operationDigest: `sha256:${job.opsDigest}`,
      });
      job.resultArtifactId = ref.id;
      setJobState(jobId, "VERIFIED", "artifact accepted");
      return ref;
    },
    async approve(jobId: string, action: OfficeReceiptAction = "commit", target = "") {
      const job = getJob(jobId);
      if (!["PREVIEW_READY", "PLAN_READY", "INSPECTED", "OWNER_APPROVED", "COMMITTED", "UNDO_READY"].includes(job.state)) {
        throw new PenglaiError("SECURITY_POLICY", "office job is not ready for approval");
      }
      if (!opts?.owner) throw new PenglaiError("SECURITY_POLICY", "office broker is not configured");
      receiptTarget(job, action, target);
      const destName = receiptDestinationLabel(job, action, target);
      if (target && action === "commit-to-path" && destName !== basename(target)) {
        throw new PenglaiError("SECURITY_POLICY", "office destination label escaped");
      }
      const proposed = proposeOfficeAction(opts.owner, {
        action,
        jobId,
        sourceDigest: job.sourceDigest,
        ...(job.workspaceId ? { workspaceId: job.workspaceId } : {}),
        ...(job.sessionId ? { sessionId: job.sessionId } : {}),
        resultDigest: receiptResultDigest(job, action),
        ...(destName ? { destinationLabel: destName } : {}),
      });
      const decided = await opts.owner.requestOwnerApproval(proposed.actionId);
      if (decided.decision !== "approved") {
        throw new PenglaiError("SECURITY_POLICY", "owner denied office action");
      }
      job.receipt = decided.receipt;
      if (action === "commit-to-path" && target && !job.destPath) job.destPath = target;
      if (job.state === "PREVIEW_READY" || job.state === "PLAN_READY" || job.state === "INSPECTED") {
        setJobState(jobId, "OWNER_APPROVED", `${officeOwnerAction(action)}`);
      } else {
        job.events.push({ at: Date.now(), state: job.state, note: officeOwnerAction(action) });
      }
      return decided.receipt;
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
      const finish = consumeReceipt(record, "commit", receipt);
      assertPreviewMatchesResult(record);
      record.stagedBytes = Buffer.from(record.bytes);
      setJobState(job, "STAGED", "bytes");
      record.resultDigest = digestBytes(record.bytes);
      record.backupBytes = Buffer.from(record.sourceBytes);
      setJobState(job, "COMMITTED", "in-memory");
      setJobState(job, "UNDO_READY", "backup retained");
      finish();
      return Buffer.from(record.bytes);
    },
    commitToPath(jobId: string, receipt: string, destPath: string, workspaceRoot: string) {
      const record = getJob(jobId);
      const dest = assertPathInWorkspace(destPath, workspaceRoot);
      const finish = consumeReceipt(record, "commit-to-path", receipt, dest);
      assertPreviewMatchesResult(record);
      if (record.destPath && record.destPath !== dest) {
        throw new PenglaiError("SECURITY_POLICY", "office path is not the bound proposal");
      }
      const backupRoot = process.env.PENGLAI_USER_DATA
        ? join(process.env.PENGLAI_USER_DATA, "office", "backups")
        : opts?.userData
          ? join(opts.userData, "office", "backups")
          : undefined;
      if (!backupRoot) throw new PenglaiError("DSH_UNAVAILABLE", "app-private office backup root unavailable");
      mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
      const backup = join(backupRoot, nextOfficeBackupName(record, "bak"));
      setJobState(jobId, "STAGED", dest);
      const result = atomicCommitFile(dest, record.bytes, backup);
      record.destPath = dest;
      record.resultDigest = result.destDigest;
      record.backupBytes = existsSync(backup) ? readFileSync(backup) : Buffer.from(record.sourceBytes);
      setJobState(jobId, "COMMITTED", result.destDigest);
      setJobState(jobId, "UNDO_READY", backup);
      finish();
      return { dest, digest: result.destDigest, backup };
    },
    undo(jobId: string, receipt: string) {
      const record = getJob(jobId);
      const finish = consumeReceipt(record, "undo", receipt);
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
          const backupRoot = process.env.PENGLAI_USER_DATA
            ? join(process.env.PENGLAI_USER_DATA, "office", "backups")
            : opts?.userData
              ? join(opts.userData, "office", "backups")
              : undefined;
          if (!backupRoot) throw new PenglaiError("DSH_UNAVAILABLE", "app-private office undo root unavailable");
          mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
          const backup = join(backupRoot, nextOfficeBackupName(record, "undo"));
          atomicCommitFile(record.destPath, record.backupBytes, backup);
        }
      }
      record.bytes = Buffer.from(record.sourceBytes);
      record.digest = record.sourceDigest;
      setJobState(jobId, "UNDONE", "restored source digest");
      finish();
      return Buffer.from(record.bytes);
    },
    async discard(jobId: string, receipt: string) {
      if (!receipt) throw new PenglaiError("SECURITY_POLICY", "office discard requires owner receipt");
      const record = getJob(jobId);
      const finish = consumeReceipt(record, "discard", receipt);
      discardJob(jobId);
      finish();
    },
    bindHandle(handle: string, bind: { sessionId: string; workspaceId?: string; routeId?: string }) {
      objects.bind(handle, bind);
    },
    async export(jobId: string, target: OfficeFormat, receipt: string) {
      if (!receipt) throw new PenglaiError("SECURITY_POLICY", "office export requires owner receipt");
      const job = getJob(jobId);
      if (target !== job.format) throw new PenglaiError("INVALID_INPUT", "office format conversion is not implemented");
      const finish = consumeReceipt(job, "export", receipt, target);
      assertPreviewMatchesResult(job);
      ingestJobBytes(job, `penglai.${job.format}`, "generated");
      finish();
      return { bytes: Buffer.from(job.bytes), format: job.format, filename: `penglai.${job.format}`, digest: job.digest, ...(job.artifactId ? { artifactId: job.artifactId } : {}) };
    },
    async returnToChannel(jobId: string, receipt: string) {
      const job = getJob(jobId);
      if (!job.routeId || !job.sessionId) {
        throw new PenglaiError("INVALID_INPUT", "office job has no original IM route");
      }
      const finish = consumeReceipt(job, "return-to-channel", receipt);
      assertPreviewMatchesResult(job);
      const outbound = opts?.outbound?.();
      if (!outbound) throw new PenglaiError("DSH_UNAVAILABLE", "Penglai IM is disabled or unavailable");
      let bytes = Buffer.from(job.bytes);
      if (opts?.artifacts && job.artifactId) {
        bytes = Buffer.from(opts.artifacts.readControlled(job.artifactId, {
          ...(job.workspaceId ? { workspaceId: job.workspaceId } : {}),
          ...(job.sessionId ? { sessionId: job.sessionId } : {}),
        }).bytes);
      } else {
        ingestJobBytes(job, `penglai.${job.format}`, "generated");
      }
      const exported = { bytes, format: job.format, filename: `penglai.${job.format}`, digest: job.digest };
      const result = await outbound.sendFileToBoundRoute({
        routeId: job.routeId,
        sessionId: job.sessionId,
        ...(job.workspaceId ? { workspaceId: job.workspaceId } : {}),
        filename: exported.filename,
        bytes: exported.bytes,
        digest: exported.digest,
      });
      finish();
      return { ...result, filename: exported.filename, digest: exported.digest, bytes: exported.bytes.length };
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
    async mergeAttached(leftHandle: string, rightHandle: string, sessionId: string, workspaceId?: string) {
      if (leftHandle === rightHandle) throw new PenglaiError("INVALID_INPUT", "office PDF merge requires two different handles");
      const left = objects.get(leftHandle, sessionId);
      const right = objects.get(rightHandle, sessionId);
      if (detect(left) !== "pdf" || detect(right) !== "pdf") {
        throw new PenglaiError("INVALID_INPUT", "office PDF merge accepts PDF handles only");
      }
      const bytes = await mergePdf(left, right);
      const seen = await inspectRaw(bytes);
      const job = createJob({
        format: "pdf",
        bytes,
        text: seen.text,
        parts: seen.parts,
        warnings: [...seen.warnings, "Merged from two session-bound PDF handles"],
        sessionId,
        ...(workspaceId ? { workspaceId } : {}),
      });
      job.sourceDigest = digestBytes(Buffer.concat([left, right]));
      job.opsDigest = digestBytes(Buffer.from(JSON.stringify({
        kind: "pdf.merge",
        left: digestBytes(left),
        right: digestBytes(right),
      })));
      freezePreviewDigest(job);
      setJobState(job.id, "PLAN_READY", "pdf.merge");
      setJobState(job.id, "PREVIEW_READY", "pdf.merge");
      return toPublic(job);
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
