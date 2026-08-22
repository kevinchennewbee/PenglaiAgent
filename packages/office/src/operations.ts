import { PenglaiError } from "@penglai/contracts";
import type { OfficeFormat } from "./formats.js";

export type OfficeOperation =
  | { kind: "docx.replaceParagraph"; paragraphIndex: number; text: string }
  | { kind: "xlsx.setCell"; sheet?: string; cell: string; value: string | number }
  | { kind: "pptx.replaceSlideText"; slideIndex: number; text: string }
  | { kind: "pdf.watermark"; text: string }
  | { kind: "pdf.rotate"; degrees: 90 | 180 | 270 };

export function operationFormat(op: OfficeOperation): OfficeFormat {
  if (op.kind.startsWith("docx.")) return "docx";
  if (op.kind.startsWith("xlsx.")) return "xlsx";
  if (op.kind.startsWith("pptx.")) return "pptx";
  return "pdf";
}

export function assertOperationForFormat(format: OfficeFormat, op: OfficeOperation): void {
  if (operationFormat(op) !== format) {
    throw new PenglaiError("INVALID_INPUT", `office operation ${op.kind} does not apply to ${format}`);
  }
}

export function operationDigestInput(op: OfficeOperation): string {
  return JSON.stringify(op);
}

export const OFFICE_LIMITS = {
  docx: "Inspect paragraphs/headers; create latin/CJK via docx; replace a numbered paragraph. Complex numbering, content-controls, and macros are refused.",
  xlsx: "Inspect sheets/cells/formulas; create/edit an explicit sheet+cell. Macros, external links, and protected workbooks are refused.",
  pptx: "Create via pptfast. Edit replaces the first text run on a numbered slide. Complex existing decks may be inspect-only.",
  pdf: "Inspect metadata/pages; latin create; watermark/rotate/merge. CJK body text is not embedded in 0.5.5. Arbitrary PDF paragraph editing is not supported.",
} as const;
