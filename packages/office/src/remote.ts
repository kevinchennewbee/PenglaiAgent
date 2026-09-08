import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError, PenglaiRemote } from "@penglai/contracts";
import type { createOfficeService, OfficeFormat, OfficeOperation } from "./service.js";
import { createPdf } from "./adapters/pdf.js";
import { artifactDigest, previewPdfPages, publicPdfPreview } from "./pdf-preview.js";

const FORMATS = new Set<OfficeFormat>(["docx", "xlsx", "pptx", "pdf"]);
const MAX_OFFICE_BYTES = 8 * 1024 * 1024;

function bytesFromBase64(value: string): Buffer {
  if (typeof value !== "string" || !value) {
    throw new PenglaiError("INVALID_INPUT", "office bytes required");
  }
  const buf = Buffer.from(value, "base64");
  if (buf.length <= 0 || buf.length > MAX_OFFICE_BYTES) {
    throw new PenglaiError("INVALID_INPUT", "office bytes size rejected");
  }
  return buf;
}

function defaultOp(format: OfficeFormat, text: string): OfficeOperation {
  if (format === "docx") return { kind: "docx.replaceParagraph", paragraphIndex: 0, text };
  if (format === "xlsx") return { kind: "xlsx.setCell", cell: "B1", value: text };
  if (format === "pptx") return { kind: "pptx.replaceSlideText", slideIndex: 0, text };
  return { kind: "pdf.watermark", text };
}

export function createOfficeRemoteApi(impl: ReturnType<typeof createOfficeService>) {
  return {
    health() {
      return { name: impl.name, version: impl.version, healthy: true, ...impl.status() };
    },
    templates() {
      return impl.templates();
    },
    async inspect(input: { bytesBase64: string }) {
      const seen = await impl.inspect(bytesFromBase64(input.bytesBase64));
      return { format: seen.format, text: seen.text, parts: seen.parts, warnings: seen.warnings };
    },
    async create(input: { format: OfficeFormat; text: string; sessionId: string; workspaceId: string }) {
      if (!input.sessionId || !input.workspaceId) {
        throw new PenglaiError("UNAUTHORIZED", "office job is not bound to this Workspace and Session");
      }
      if (!FORMATS.has(input.format)) throw new PenglaiError("INVALID_INPUT", "unsupported office format");
      const job = await impl.create(input.format, input.text, {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
      });
      return {
        id: job.id,
        format: job.format,
        text: job.text,
        parts: job.parts,
        warnings: job.warnings,
        bytesBase64: job.bytes.toString("base64"),
      };
    },
    async edit(input: {
      bytesBase64: string;
      sessionId: string;
      workspaceId: string;
      operation?: OfficeOperation;
      replacement?: string;
      format?: OfficeFormat;
    }) {
      if (!input.sessionId || !input.workspaceId) {
        throw new PenglaiError("UNAUTHORIZED", "office job is not bound to this Workspace and Session");
      }
      const bytes = bytesFromBase64(input.bytesBase64);
      const format = input.format ?? (await impl.inspect(bytes)).format;
      const op = input.operation ?? defaultOp(format, input.replacement ?? "");
      const job = await impl.edit(bytes, op, {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
      });
      return {
        id: job.id,
        format: job.format,
        text: job.text,
        parts: job.parts,
        warnings: job.warnings,
        bytesBase64: job.bytes.toString("base64"),
      };
    },
    async preview(input: { jobId: string; sessionId?: string; workspaceId?: string }) {
      if (!input.sessionId || !input.workspaceId) {
        throw new PenglaiError("UNAUTHORIZED", "office job is not bound to this Workspace and Session");
      }
      return impl.preview(input.jobId, { sessionId: input.sessionId, workspaceId: input.workspaceId });
    },
    async approve(input: { jobId: string; sessionId?: string; workspaceId?: string }) {
      if (!input.sessionId || !input.workspaceId) {
        throw new PenglaiError("UNAUTHORIZED", "office job is not bound to this Workspace and Session");
      }
      return { receipt: await impl.approve(input.jobId, "commit", "", { sessionId: input.sessionId, workspaceId: input.workspaceId }) };
    },
    async samplePdfPreview() {
      const bytes = await createPdf("Penglai Office PDF page preview");
      return publicPdfPreview(await previewPdfPages(bytes, artifactDigest(bytes)));
    },
    commit(input: { jobId: string; receipt: string; sessionId?: string; workspaceId?: string }) {
      if (!input.sessionId || !input.workspaceId) {
        throw new PenglaiError("UNAUTHORIZED", "office job is not bound to this Workspace and Session");
      }
      const job = impl.job(input.jobId);
      if (job.sessionId !== input.sessionId || job.workspaceId !== input.workspaceId) {
        throw new PenglaiError("UNAUTHORIZED", "office job is not bound to this Workspace and Session");
      }
      const bytes = impl.commit(input.jobId, input.receipt, {
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
      });
      return { bytesBase64: bytes.toString("base64") };
    },
  };
}

export class PenglaiOfficeRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly impl: ReturnType<typeof createOfficeService>,
  ) {
    super(ctx, "penglaiOfficeSettings");
  }

  @PenglaiRemote
  health() {
    return createOfficeRemoteApi(this.impl).health();
  }

  @PenglaiRemote
  templates() {
    return createOfficeRemoteApi(this.impl).templates();
  }

  @PenglaiRemote
  inspect(input: { bytesBase64: string }) {
    return createOfficeRemoteApi(this.impl).inspect(input);
  }

  @PenglaiRemote
  create(input: { format: OfficeFormat; text: string; sessionId: string; workspaceId: string }) {
    return createOfficeRemoteApi(this.impl).create(input);
  }

  @PenglaiRemote
  edit(input: {
    bytesBase64: string;
    sessionId: string;
    workspaceId: string;
    operation?: OfficeOperation;
    replacement?: string;
    format?: OfficeFormat;
  }) {
    return createOfficeRemoteApi(this.impl).edit(input);
  }

  @PenglaiRemote
  preview(input: { jobId: string; sessionId: string; workspaceId: string }) {
    return createOfficeRemoteApi(this.impl).preview(input);
  }

  @PenglaiRemote
  approve(input: { jobId: string; sessionId: string; workspaceId: string }) {
    return createOfficeRemoteApi(this.impl).approve(input);
  }

  @PenglaiRemote
  commit(input: { jobId: string; receipt: string; sessionId: string; workspaceId: string }) {
    return createOfficeRemoteApi(this.impl).commit(input);
  }

  @PenglaiRemote
  samplePdfPreview() {
    return createOfficeRemoteApi(this.impl).samplePdfPreview();
  }
}

export const TYPERT_REMOTE = {
  package: "@penglai/office",
  descriptors: ["health", "templates", "inspect", "create", "edit", "preview", "approve", "commit", "samplePdfPreview"],
};
