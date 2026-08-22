import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { PenglaiError } from "@penglai/contracts";
import { assertAuthorizedBytes } from "../authorization.js";

function utf16BeHex(text: string): string {
  const units = Buffer.alloc(2 + text.length * 2);
  units[0] = 0xfe;
  units[1] = 0xff;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    units[2 + i * 2] = (code >> 8) & 0xff;
    units[3 + i * 2] = code & 0xff;
  }
  return units.toString("hex").toUpperCase();
}

function decodePdfText(raw: string): string {
  const parts: string[] = [];
  for (const match of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const buf = Buffer.from(match[1] ?? "", "hex");
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      let decoded = "";
      for (let i = 2; i + 1 < buf.length; i += 2) decoded += String.fromCharCode((buf[i]! << 8) | buf[i + 1]!);
      parts.push(decoded);
    } else {
      parts.push(buf.toString("latin1"));
    }
  }
  for (const match of raw.matchAll(/\(([^()\\]*)\)/g)) parts.push(match[1] ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export async function createPdf(text: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(text);
  pdf.setSubject(text);
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  try {
    page.drawText(text, { x: 72, y: 720, size: 12, font });
  } catch {
    page.drawText("Penglai Office", { x: 72, y: 740, size: 10, font, color: rgb(0, 0, 0) });
  }
  const bytes = Buffer.from(await pdf.save());
  if (/[^\u0000-\u00ff]/.test(text)) {
    return appendCjkStream(bytes, text);
  }
  return bytes;
}

function appendCjkStream(bytes: Buffer, text: string): Buffer {
  const extra = `BT /F1 12 Tf 72 680 Td <${utf16BeHex(text)}> Tj ET`;
  const raw = bytes.toString("latin1");
  const startxref = Number([...raw.matchAll(/startxref\s+(\d+)/g)].at(-1)?.[1] ?? 0);
  const size = Number([...raw.matchAll(/\/Size\s+(\d+)/g)].at(-1)?.[1] ?? 1);
  const origContents = (raw.match(/\/Contents\s+(\d+\s+0\s+R)/) ?? [])[1] ?? "4 0 R";
  const streamNo = size;
  const pageNo = size + 1;
  const pagesNo = size + 2;
  const catalogNo = size + 3;
  const prefix = raw.endsWith("\n") ? raw : `${raw}\n`;
  const objects = [
    `${streamNo} 0 obj << /Length ${Buffer.byteLength(extra, "latin1")} >> stream\n${extra}\nendstream endobj\n`,
    `${pageNo} 0 obj << /Type /Page /Parent ${pagesNo} 0 R /MediaBox [0 0 612 792] /Contents [${origContents} ${streamNo} 0 R] /Resources << /Font << /F1 5 0 R >> >> >> endobj\n`,
    `${pagesNo} 0 obj << /Type /Pages /Kids [${pageNo} 0 R] /Count 1 >> endobj\n`,
    `${catalogNo} 0 obj << /Type /Catalog /Pages ${pagesNo} 0 R >> endobj\n`,
  ];
  let pos = Buffer.byteLength(prefix, "latin1");
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(pos);
    pos += Buffer.byteLength(obj, "latin1");
  }
  const xrefLine = (offset: number, gen = 0, used = true) =>
    `${String(offset).padStart(10, "0")} ${String(gen).padStart(5, "0")} ${used ? "n" : "f"} \n`;
  const xref = `xref\n0 1\n${xrefLine(0, 65535, false)}${streamNo} 4\n${offsets.map((off) => xrefLine(off)).join("")}`;
  const tail = `trailer << /Size ${catalogNo + 1} /Root ${catalogNo} 0 R /Prev ${startxref} >>\nstartxref\n${pos}\n%%EOF\n`;
  return Buffer.from(prefix + objects.join("") + xref + tail, "latin1");
}

export async function inspectPdf(bytes: Buffer): Promise<{ text: string; parts: string[] }> {
  assertAuthorizedBytes(bytes);
  if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") throw new PenglaiError("INVALID_INPUT", "unsupported office format");
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const meta = [pdf.getTitle(), pdf.getSubject()].filter(Boolean).join(" ");
  return {
    text: [meta, decodePdfText(bytes.toString("latin1"))].filter(Boolean).join(" "),
    parts: [`pages:${pdf.getPageCount()}`],
  };
}

export async function editPdf(bytes: Buffer, replacement: string): Promise<Buffer> {
  assertAuthorizedBytes(bytes);
  return appendCjkStream(bytes, replacement);
}

export async function rotatePdf(bytes: Buffer): Promise<Buffer> {
  const pdf = await PDFDocument.load(bytes);
  for (const page of pdf.getPages()) page.setRotation(degrees(90));
  return Buffer.from(await pdf.save());
}

export async function mergePdf(left: Buffer, right: Buffer): Promise<Buffer> {
  const out = await PDFDocument.create();
  const a = await PDFDocument.load(left);
  const b = await PDFDocument.load(right);
  const pages = await out.copyPages(a, a.getPageIndices());
  for (const page of pages) out.addPage(page);
  const more = await out.copyPages(b, b.getPageIndices());
  for (const page of more) out.addPage(page);
  return Buffer.from(await out.save());
}
