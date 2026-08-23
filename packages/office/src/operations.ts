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

export function parseOfficeOperation(value: unknown): OfficeOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PenglaiError("INVALID_INPUT", "office operation required");
  }
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length > 6) throw new PenglaiError("INVALID_INPUT", "office operation has extra fields");
  if (raw.kind === "docx.replaceParagraph") {
    if (typeof raw.paragraphIndex !== "number" || !Number.isInteger(raw.paragraphIndex) || raw.paragraphIndex < 0 || raw.paragraphIndex > 4000) {
      throw new PenglaiError("INVALID_INPUT", "docx paragraphIndex rejected");
    }
    if (typeof raw.text !== "string" || raw.text.length < 1 || raw.text.length > 8000) {
      throw new PenglaiError("INVALID_INPUT", "docx replacement text rejected");
    }
    return { kind: "docx.replaceParagraph", paragraphIndex: raw.paragraphIndex, text: raw.text };
  }
  if (raw.kind === "xlsx.setCell") {
    if (typeof raw.cell !== "string" || !/^[A-Z]{1,3}[1-9][0-9]{0,4}$/.test(raw.cell)) {
      throw new PenglaiError("INVALID_INPUT", "xlsx cell rejected");
    }
    if (typeof raw.value !== "string" && typeof raw.value !== "number") {
      throw new PenglaiError("INVALID_INPUT", "xlsx value rejected");
    }
    if (typeof raw.value === "string" && raw.value.length > 8000) {
      throw new PenglaiError("INVALID_INPUT", "xlsx value too long");
    }
    if (raw.sheet !== undefined && (typeof raw.sheet !== "string" || raw.sheet.length > 64)) {
      throw new PenglaiError("INVALID_INPUT", "xlsx sheet rejected");
    }
    return {
      kind: "xlsx.setCell",
      cell: raw.cell,
      value: raw.value,
      ...(typeof raw.sheet === "string" ? { sheet: raw.sheet } : {}),
    };
  }
  if (raw.kind === "pptx.replaceSlideText") {
    if (typeof raw.slideIndex !== "number" || !Number.isInteger(raw.slideIndex) || raw.slideIndex < 0 || raw.slideIndex > 400) {
      throw new PenglaiError("INVALID_INPUT", "pptx slideIndex rejected");
    }
    if (typeof raw.text !== "string" || raw.text.length < 1 || raw.text.length > 8000) {
      throw new PenglaiError("INVALID_INPUT", "pptx replacement text rejected");
    }
    return { kind: "pptx.replaceSlideText", slideIndex: raw.slideIndex, text: raw.text };
  }
  if (raw.kind === "pdf.watermark") {
    if (typeof raw.text !== "string" || raw.text.length < 1 || raw.text.length > 200) {
      throw new PenglaiError("INVALID_INPUT", "pdf watermark text rejected");
    }
    return { kind: "pdf.watermark", text: raw.text };
  }
  if (raw.kind === "pdf.rotate") {
    if (raw.degrees !== 90 && raw.degrees !== 180 && raw.degrees !== 270) {
      throw new PenglaiError("INVALID_INPUT", "pdf rotate degrees rejected");
    }
    return { kind: "pdf.rotate", degrees: raw.degrees };
  }
  throw new PenglaiError("INVALID_INPUT", "office operation is not in the closed typed set");
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
  pdf: "Inspect metadata/pages; create/watermark with the bundled OFL CJK font; rotate/merge. Arbitrary PDF paragraph rewriting is not supported.",
} as const;
