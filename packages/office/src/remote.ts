import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError } from "@penglai/contracts";
import type { createOfficeService, OfficeFormat } from "./service.js";

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

export function createOfficeRemoteApi(impl: ReturnType<typeof createOfficeService>) {
  return {
    health() {
      return { name: impl.name, version: impl.version, healthy: true, ...impl.status() };
    },
    inspect(input: { bytesBase64: string }) {
      const seen = impl.inspect(bytesFromBase64(input.bytesBase64));
      return { format: seen.format, text: seen.text, parts: seen.parts };
    },
    create(input: { format: OfficeFormat; text: string }) {
      if (!FORMATS.has(input.format)) throw new PenglaiError("INVALID_INPUT", "unsupported office format");
      const job = impl.create(input.format, input.text);
      return {
        id: job.id,
        format: job.format,
        text: job.text,
        bytesBase64: job.bytes.toString("base64"),
      };
    },
    edit(input: { bytesBase64: string; replacement: string }) {
      const job = impl.edit(bytesFromBase64(input.bytesBase64), input.replacement);
      return {
        id: job.id,
        format: job.format,
        text: job.text,
        bytesBase64: job.bytes.toString("base64"),
      };
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
  edit(input: { bytesBase64: string; replacement: string }) {
    return createOfficeRemoteApi(this.impl).edit(input);
  }
}

export const TYPERT_REMOTE = {
  package: "@penglai/office",
  descriptors: ["health", "inspect", "create", "edit"],
};
