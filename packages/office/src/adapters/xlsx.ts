import ExcelJS from "exceljs";
import { PenglaiError } from "@penglai/contracts";
import { assertAuthorizedBytes } from "../authorization.js";

export async function createXlsx(text: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Sheet1");
  sheet.getCell("A1").value = text;
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
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

export async function editXlsx(bytes: Buffer, replacement: string): Promise<Buffer> {
  assertAuthorizedBytes(bytes);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as never);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new PenglaiError("INVALID_INPUT", "xlsx sheet missing");
  sheet.getCell("A999").value = replacement;
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function verifyXlsx(bytes: Buffer): Promise<{ ok: true; refError: false }> {
  const seen = await inspectXlsx(bytes);
  if (seen.text.includes("#REF!")) throw new PenglaiError("INVALID_INPUT", "xlsx formula #REF!");
  return { ok: true, refError: false };
}
