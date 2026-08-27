import { PenglaiError } from "@penglai/contracts";
import type { OfficeFormat } from "./formats.js";
import type { OfficeScalar } from "./specs.js";

export type OfficeOperation =
  | { kind: "docx.replaceParagraph"; paragraphIndex: number; text: string }
  | { kind: "docx.insertParagraph"; paragraphIndex: number; position: "before" | "after"; text: string }
  | { kind: "docx.appendParagraph"; text: string }
  | { kind: "docx.replaceTableCell"; tableIndex: number; rowIndex: number; cellIndex: number; text: string }
  | { kind: "xlsx.setCell"; sheet?: string; cell: string; value: OfficeScalar; formula?: boolean }
  | { kind: "xlsx.setRange"; sheet?: string; startCell: string; values: OfficeScalar[][] }
  | { kind: "xlsx.appendRows"; sheet?: string; values: OfficeScalar[][] }
  | { kind: "pptx.replaceSlideText"; slideIndex: number; runIndex?: number; text: string }
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
  if (raw.kind === "docx.replaceParagraph" || raw.kind === "docx.insertParagraph") {
    if (typeof raw.paragraphIndex !== "number" || !Number.isInteger(raw.paragraphIndex) || raw.paragraphIndex < 0 || raw.paragraphIndex > 4000) {
      throw new PenglaiError("INVALID_INPUT", "docx paragraphIndex rejected");
    }
    if (typeof raw.text !== "string" || raw.text.length < 1 || raw.text.length > 8000) {
      throw new PenglaiError("INVALID_INPUT", "docx replacement text rejected");
    }
    if (raw.kind === "docx.insertParagraph" && raw.position !== "before" && raw.position !== "after") {
      throw new PenglaiError("INVALID_INPUT", "docx insert position rejected");
    }
    return raw.kind === "docx.insertParagraph"
      ? { kind: raw.kind, paragraphIndex: raw.paragraphIndex, position: raw.position as "before" | "after", text: raw.text }
      : { kind: raw.kind, paragraphIndex: raw.paragraphIndex, text: raw.text };
  }
  if (raw.kind === "docx.appendParagraph") {
    if (typeof raw.text !== "string" || raw.text.length < 1 || raw.text.length > 8000) {
      throw new PenglaiError("INVALID_INPUT", "docx append text rejected");
    }
    return { kind: raw.kind, text: raw.text };
  }
  if (raw.kind === "docx.replaceTableCell") {
    for (const key of ["tableIndex", "rowIndex", "cellIndex"] as const) {
      if (typeof raw[key] !== "number" || !Number.isInteger(raw[key]) || raw[key] < 0 || raw[key] > 4000) {
        throw new PenglaiError("INVALID_INPUT", `docx ${key} rejected`);
      }
    }
    if (typeof raw.text !== "string" || raw.text.length < 1 || raw.text.length > 8000) throw new PenglaiError("INVALID_INPUT", "docx table text rejected");
    return { kind: raw.kind, tableIndex: raw.tableIndex as number, rowIndex: raw.rowIndex as number, cellIndex: raw.cellIndex as number, text: raw.text };
  }
  if (raw.kind === "xlsx.setCell") {
    if (typeof raw.cell !== "string" || !/^[A-Z]{1,3}[1-9][0-9]{0,4}$/.test(raw.cell)) {
      throw new PenglaiError("INVALID_INPUT", "xlsx cell rejected");
    }
    if (raw.value !== null && typeof raw.value !== "string" && typeof raw.value !== "number" && typeof raw.value !== "boolean") {
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
      ...(raw.formula === true ? { formula: true } : {}),
      ...(typeof raw.sheet === "string" ? { sheet: raw.sheet } : {}),
    };
  }
  if (raw.kind === "xlsx.setRange" || raw.kind === "xlsx.appendRows") {
    if (raw.sheet !== undefined && (typeof raw.sheet !== "string" || raw.sheet.length > 64)) throw new PenglaiError("INVALID_INPUT", "xlsx sheet rejected");
    if (raw.kind === "xlsx.setRange" && (typeof raw.startCell !== "string" || !/^[A-Z]{1,3}[1-9][0-9]{0,4}$/.test(raw.startCell))) throw new PenglaiError("INVALID_INPUT", "xlsx range start rejected");
    const values = parseCellMatrix(raw.values);
    return raw.kind === "xlsx.setRange"
      ? { kind: raw.kind, startCell: raw.startCell as string, values, ...(typeof raw.sheet === "string" ? { sheet: raw.sheet } : {}) }
      : { kind: raw.kind, values, ...(typeof raw.sheet === "string" ? { sheet: raw.sheet } : {}) };
  }
  if (raw.kind === "pptx.replaceSlideText") {
    if (typeof raw.slideIndex !== "number" || !Number.isInteger(raw.slideIndex) || raw.slideIndex < 0 || raw.slideIndex > 400) {
      throw new PenglaiError("INVALID_INPUT", "pptx slideIndex rejected");
    }
    if (typeof raw.text !== "string" || raw.text.length < 1 || raw.text.length > 8000) {
      throw new PenglaiError("INVALID_INPUT", "pptx replacement text rejected");
    }
    if (raw.runIndex !== undefined && (typeof raw.runIndex !== "number" || !Number.isInteger(raw.runIndex) || raw.runIndex < 0 || raw.runIndex > 1000)) throw new PenglaiError("INVALID_INPUT", "pptx runIndex rejected");
    return { kind: "pptx.replaceSlideText", slideIndex: raw.slideIndex, text: raw.text, ...(typeof raw.runIndex === "number" ? { runIndex: raw.runIndex } : {}) };
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

function parseCellMatrix(value: unknown): OfficeScalar[][] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2_000) throw new PenglaiError("INVALID_INPUT", "xlsx matrix rejected");
  let cells = 0;
  return value.map((row) => {
    if (!Array.isArray(row) || row.length > 100) throw new PenglaiError("INVALID_INPUT", "xlsx matrix row rejected");
    cells += row.length;
    if (cells > 10_000) throw new PenglaiError("INVALID_INPUT", "xlsx matrix cell limit");
    return row.map((cell) => {
      if (cell !== null && typeof cell !== "string" && typeof cell !== "number" && typeof cell !== "boolean") throw new PenglaiError("INVALID_INPUT", "xlsx matrix scalar rejected");
      if (typeof cell === "string" && cell.length > 8000) throw new PenglaiError("INVALID_INPUT", "xlsx matrix text rejected");
      return cell as OfficeScalar;
    });
  });
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
  docx: "Inspect bounded title/paragraph/table/header inventory; structured create; indexed paragraph insert/append/replace and table-cell replacement. Complex numbering, content-controls, and macros are refused.",
  xlsx: "Inspect bounded sheets/cells/formulas; structured multi-sheet create; explicit cell/range/row edits. Macros, external links, and protected workbooks are refused.",
  pptx: "Structured multi-slide create via pptfast; edit replaces an explicit text run on a numbered slide. Complex existing decks may be inspect-only.",
  pdf: "Inspect metadata/pages; create/watermark with the bundled OFL CJK font; rotate/merge. Arbitrary PDF paragraph rewriting is not supported.",
} as const;
