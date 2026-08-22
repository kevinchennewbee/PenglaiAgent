import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError } from "@penglai/contracts";
import type { createOfficeService, OfficeFormat, OfficeOperation } from "./service.js";

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
    async inspect(input: { bytesBase64: string }) {
      const seen = await impl.inspect(bytesFromBase64(input.bytesBase64));
      return { format: seen.format, text: seen.text, parts: seen.parts, warnings: seen.warnings };
    },
    async create(input: { format: OfficeFormat; text: string }) {
      if (!FORMATS.has(input.format)) throw new PenglaiError("INVALID_INPUT", "unsupported office format");
      const job = await impl.create(input.format, input.text);
      return {
        id: job.id,
        format: job.format,
        text: job.text,
        parts: job.parts,
        warnings: job.warnings,
        bytesBase64: job.bytes.toString("base64"),
      };
    },
    async edit(input: { bytesBase64: string; operation?: OfficeOperation; replacement?: string; format?: OfficeFormat }) {
      const bytes = bytesFromBase64(input.bytesBase64);
      const format = input.format ?? (await impl.inspect(bytes)).format;
      const op = input.operation ?? defaultOp(format, input.replacement ?? "");
      const job = await impl.edit(bytes, op);
      return {
        id: job.id,
        format: job.format,
        text: job.text,
        parts: job.parts,
        warnings: job.warnings,
        bytesBase64: job.bytes.toString("base64"),
      };
    },
    async preview(input: { jobId: string }) {
      return impl.preview(input.jobId);
    },
    approve(input: { jobId: string }) {
      return { receipt: impl.approve(input.jobId) };
    },
    commit(input: { jobId: string; receipt: string }) {
      const bytes = impl.commit(input.jobId, input.receipt);
      return { bytesBase64: bytes.toString("base64") };
    },
  };
}

export class PenglaiOfficeRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly impl: ReturnType<typeof createOfficeService>,
  ) {
    super(ctx, "penglaiOffice");
  }

  @Remote
  health() {
    return createOfficeRemoteApi(this.impl).health();
  }

  @Remote
  inspect(input: { bytesBase64: string }) {
    return createOfficeRemoteApi(this.impl).inspect(input);
  }

  @Remote
  create(input: { format: OfficeFormat; text: string }) {
    return createOfficeRemoteApi(this.impl).create(input);
  }

  @Remote
  edit(input: { bytesBase64: string; operation?: OfficeOperation; replacement?: string; format?: OfficeFormat }) {
    return createOfficeRemoteApi(this.impl).edit(input);
  }

  @Remote
  preview(input: { jobId: string }) {
    return createOfficeRemoteApi(this.impl).preview(input);
  }

  @Remote
  approve(input: { jobId: string }) {
    return createOfficeRemoteApi(this.impl).approve(input);
  }

  @Remote
  commit(input: { jobId: string; receipt: string }) {
    return createOfficeRemoteApi(this.impl).commit(input);
  }
}

export const TYPERT_REMOTE = {
  package: "@penglai/office",
  descriptors: ["health", "inspect", "create", "edit", "preview", "approve", "commit"],
};
