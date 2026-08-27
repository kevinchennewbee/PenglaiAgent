import ExcelJS from "exceljs";
import { PenglaiError } from "@penglai/contracts";
import { assertAuthorizedBytes } from "../authorization.js";
import type { OfficeScalar, XlsxCreateSpec } from "../specs.js";

export async function createXlsx(text: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Sheet1");
  sheet.getCell("A1").value = text;
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function createXlsxFromSpec(spec: XlsxCreateSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheetSpec of spec.sheets) {
    const sheet = wb.addWorksheet(sheetSpec.name);
    for (const row of sheetSpec.rows) sheet.addRow(row as ExcelJS.CellValue[]);
    if (sheetSpec.header && sheet.rowCount > 0) {
      const header = sheet.getRow(1);
      header.font = { bold: true };
      header.alignment = { vertical: "middle" };
    }
    sheetSpec.columnWidths?.forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function inspectXlsx(bytes: Buffer): Promise<{ text: string; parts: string[] }> {
  assertAuthorizedBytes(bytes);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as never);
  const cells: string[] = [];
  const parts: string[] = [];
  wb.eachSheet((sheet) => {
    parts.push(sheet.name);
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        const value = cell.formula ? `=${cell.formula}` : String(cell.value ?? "");
        if (value) cells.push(value);
      });
    });
  });
  return { text: cells.join(" "), parts };
}

export async function editXlsx(
  bytes: Buffer,
  op:
    | { kind?: "xlsx.setCell"; sheet?: string; cell: string; value: OfficeScalar; formula?: boolean }
    | { kind: "xlsx.setRange"; sheet?: string; startCell: string; values: OfficeScalar[][] }
    | { kind: "xlsx.appendRows"; sheet?: string; values: OfficeScalar[][] },
): Promise<Buffer> {
  assertAuthorizedBytes(bytes);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as never);
  const sheet = op.sheet ? wb.getWorksheet(op.sheet) : wb.worksheets[0];
  if (!sheet) throw new PenglaiError("INVALID_INPUT", "xlsx sheet missing");
  if (op.kind === "xlsx.appendRows") {
    for (const row of op.values) sheet.addRow(row as ExcelJS.CellValue[]);
  } else if (op.kind === "xlsx.setRange") {
    const match = /^([A-Z]{1,3})([1-9][0-9]{0,4})$/i.exec(op.startCell);
    if (!match) throw new PenglaiError("INVALID_INPUT", "xlsx range start invalid");
    const startColumn = columnNumber(match[1]!);
    const startRow = Number(match[2]);
    op.values.forEach((row, r) => row.forEach((value, c) => {
      sheet.getCell(startRow + r, startColumn + c).value = value as ExcelJS.CellValue;
    }));
  } else {
    if (!/^[A-Z]+[0-9]+$/i.test(op.cell)) throw new PenglaiError("INVALID_INPUT", "xlsx cell invalid");
    sheet.getCell(op.cell.toUpperCase()).value = op.formula === true
      ? ({ formula: String(op.value) } as never)
      : op.value as ExcelJS.CellValue;
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function columnNumber(label: string): number {
  let out = 0;
  for (const ch of label.toUpperCase()) out = out * 26 + ch.charCodeAt(0) - 64;
  return out;
}

export async function verifyXlsx(bytes: Buffer): Promise<{ ok: true; refError: false }> {
  const seen = await inspectXlsx(bytes);
  if (seen.text.includes("#REF!")) throw new PenglaiError("INVALID_INPUT", "xlsx formula #REF!");
  return { ok: true, refError: false };
}
