import { PenglaiError } from "@penglai/contracts";
import type { OfficeFormat } from "./formats.js";

export type OfficeScalar = string | number | boolean | null;

export interface DocxCreateSpec {
  format: "docx";
  title?: string;
  sections: Array<{
    heading?: string;
    paragraphs?: string[];
    bullets?: string[];
    table?: { headers?: string[]; rows: string[][] };
  }>;
}

export interface XlsxCreateSpec {
  format: "xlsx";
  sheets: Array<{
    name: string;
    rows: OfficeScalar[][];
    header?: boolean;
    columnWidths?: number[];
  }>;
}

export interface PptxCreateSpec {
  format: "pptx";
  title?: string;
  theme?: "consulting" | "tech" | "minimal";
  slides: Array<{
    kind: "cover" | "content" | "ending";
    heading: string;
    subheading?: string;
    bullets?: string[];
    notes?: string;
  }>;
}

export interface PdfCreateSpec {
  format: "pdf";
  title?: string;
  paragraphs: string[];
}

export type OfficeCreateSpec = DocxCreateSpec | XlsxCreateSpec | PptxCreateSpec | PdfCreateSpec;

const MAX_TEXT = 8_000;
const MAX_TOTAL_TEXT = 64_000;

function reject(message: string): never {
  throw new PenglaiError("INVALID_INPUT", message);
}

function closedRecord(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(`${label} required`);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !allowed.includes(key))) reject(`${label} has extra fields`);
  return row;
}

function text(value: unknown, label: string, optional = false): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > MAX_TEXT) reject(`${label} rejected`);
  return value;
}

function textList(value: unknown, label: string, max = 200): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > max) reject(`${label} rejected`);
  return value.map((item, index) => text(item, `${label}[${index}]`)!);
}

function totalText(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + totalText(item), 0);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).reduce<number>((sum, item) => sum + totalText(item), 0);
  return 0;
}

export function parseOfficeCreateSpec(value: unknown): OfficeCreateSpec {
  const root = closedRecord(value, ["format", "title", "theme", "sections", "sheets", "slides", "paragraphs"], "office create spec");
  if (totalText(root) > MAX_TOTAL_TEXT) reject("office create spec text limit");
  const format = root.format as OfficeFormat;
  if (format === "docx") {
    if (!Array.isArray(root.sections) || root.sections.length < 1 || root.sections.length > 40) reject("docx sections rejected");
    const sections = root.sections.map((item, index) => {
      const row = closedRecord(item, ["heading", "paragraphs", "bullets", "table"], `docx section ${index}`);
      let table: DocxCreateSpec["sections"][number]["table"];
      if (row.table !== undefined) {
        const rawTable = closedRecord(row.table, ["headers", "rows"], `docx table ${index}`);
        if (!Array.isArray(rawTable.rows) || rawTable.rows.length > 100) reject("docx table rows rejected");
        const rows = rawTable.rows.map((cells, r) => {
          if (!Array.isArray(cells) || cells.length > 20) reject("docx table columns rejected");
          return cells.map((cell, c) => text(cell, `docx table ${r}:${c}`)!);
        });
        table = { rows, ...(textList(rawTable.headers, "docx table headers", 20) ? { headers: textList(rawTable.headers, "docx table headers", 20)! } : {}) };
      }
      const heading = text(row.heading, "docx heading", true);
      const paragraphs = textList(row.paragraphs, "docx paragraphs");
      const bullets = textList(row.bullets, "docx bullets");
      if (!heading && !paragraphs?.length && !bullets?.length && !table) reject("empty docx section");
      return { ...(heading ? { heading } : {}), ...(paragraphs ? { paragraphs } : {}), ...(bullets ? { bullets } : {}), ...(table ? { table } : {}) };
    });
    const title = text(root.title, "docx title", true);
    return { format, sections, ...(title ? { title } : {}) };
  }
  if (format === "xlsx") {
    if (!Array.isArray(root.sheets) || root.sheets.length < 1 || root.sheets.length > 20) reject("xlsx sheets rejected");
    const seen = new Set<string>();
    const sheets = root.sheets.map((item, index) => {
      const row = closedRecord(item, ["name", "rows", "header", "columnWidths"], `xlsx sheet ${index}`);
      const name = text(row.name, "xlsx sheet name")!;
      if (name.length > 31 || /[\\/*?:\[\]]/.test(name) || seen.has(name.toLowerCase())) reject("xlsx sheet name rejected");
      seen.add(name.toLowerCase());
      if (!Array.isArray(row.rows) || row.rows.length > 2_000) reject("xlsx rows rejected");
      let cells = 0;
      const rows = row.rows.map((rawRow) => {
        if (!Array.isArray(rawRow) || rawRow.length > 100) reject("xlsx columns rejected");
        cells += rawRow.length;
        return rawRow.map((cell) => {
          if (cell !== null && typeof cell !== "string" && typeof cell !== "number" && typeof cell !== "boolean") reject("xlsx scalar rejected");
          if (typeof cell === "string" && cell.length > MAX_TEXT) reject("xlsx scalar text rejected");
          return cell as OfficeScalar;
        });
      });
      if (cells > 10_000) reject("xlsx cell limit");
      let columnWidths: number[] | undefined;
      if (row.columnWidths !== undefined) {
        if (!Array.isArray(row.columnWidths) || row.columnWidths.length > 100 || row.columnWidths.some((n) => typeof n !== "number" || n < 4 || n > 80)) reject("xlsx column widths rejected");
        columnWidths = row.columnWidths as number[];
      }
      return { name, rows, ...(row.header === true ? { header: true } : {}), ...(columnWidths ? { columnWidths } : {}) };
    });
    return { format, sheets };
  }
  if (format === "pptx") {
    if (!Array.isArray(root.slides) || root.slides.length < 1 || root.slides.length > 80) reject("pptx slides rejected");
    const slides = root.slides.map((item, index) => {
      const row = closedRecord(item, ["kind", "heading", "subheading", "bullets", "notes"], `pptx slide ${index}`);
      if (row.kind !== "cover" && row.kind !== "content" && row.kind !== "ending") reject("pptx slide kind rejected");
      const heading = text(row.heading, "pptx heading")!;
      const subheading = text(row.subheading, "pptx subheading", true);
      const bullets = textList(row.bullets, "pptx bullets", 20);
      const notes = text(row.notes, "pptx notes", true);
      if (row.kind !== "content" && bullets?.length) reject("pptx bullets require content slide");
      return { kind: row.kind as "cover" | "content" | "ending", heading, ...(subheading ? { subheading } : {}), ...(bullets ? { bullets } : {}), ...(notes ? { notes } : {}) };
    });
    const title = text(root.title, "pptx title", true);
    const theme = root.theme === undefined ? undefined : root.theme;
    if (theme !== undefined && theme !== "consulting" && theme !== "tech" && theme !== "minimal") reject("pptx theme rejected");
    return { format, slides, ...(title ? { title } : {}), ...(theme ? { theme } : {}) };
  }
  if (format === "pdf") {
    const paragraphs = textList(root.paragraphs, "pdf paragraphs", 200);
    if (!paragraphs?.length) reject("pdf paragraphs required");
    const title = text(root.title, "pdf title", true);
    return { format, paragraphs, ...(title ? { title } : {}) };
  }
  reject("unsupported office create spec");
}
