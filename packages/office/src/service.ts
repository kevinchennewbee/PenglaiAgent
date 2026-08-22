import { PenglaiError, RELEASE } from "@penglai/contracts";
import { readZip, writeZip } from "./zip.js";

export type OfficeFormat = "docx" | "xlsx" | "pptx" | "pdf";

export interface DocumentInventory {
  format: OfficeFormat;
  text: string;
  parts: string[];
}

export interface OfficeJob {
  id: string;
  format: OfficeFormat;
  bytes: Buffer;
  text: string;
}

const SECRET = /api[_-]?key|password|private key/i;

function xmlText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function detect(bytes: Buffer): OfficeFormat {
  if (bytes.subarray(0, 4).toString("binary") === "%PDF") return "pdf";
  if (bytes.subarray(0, 2).toString("binary") === "PK") {
    const names = readZip(bytes).map((e) => e.name);
    if (names.some((n) => n.startsWith("word/"))) return "docx";
    if (names.some((n) => n.startsWith("xl/"))) return "xlsx";
    if (names.some((n) => n.startsWith("ppt/"))) return "pptx";
  }
  throw new PenglaiError("INVALID_INPUT", "unsupported office format");
}

function requireSafe(text: string): void {
  if (SECRET.test(text)) throw new PenglaiError("SECURITY_POLICY", "office secret rejection");
}

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
      for (let i = 2; i + 1 < buf.length; i += 2) {
        decoded += String.fromCharCode((buf[i]! << 8) | buf[i + 1]!);
      }
      parts.push(decoded);
    } else {
      parts.push(buf.toString("latin1"));
    }
  }
  for (const match of raw.matchAll(/\(([^()\\]*)\)/g)) {
    parts.push(match[1] ?? "");
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function inspect(bytes: Buffer): DocumentInventory {
  const format = detect(bytes);
  if (format === "pdf") {
    return { format, text: decodePdfText(bytes.toString("latin1")), parts: ["pdf"] };
  }
  const entries = readZip(bytes);
  const xml = entries
    .filter((e) => e.name.endsWith(".xml"))
    .map((e) => xmlText(e.data.toString("utf8")))
    .filter(Boolean)
    .join(" ");
  return { format, text: xml, parts: entries.map((e) => e.name) };
}

function contentTypes(extra: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${extra}
</Types>`;
}

function rels(target: string, type: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${type}" Target="${target}"/>
</Relationships>`;
}

export function createDocument(format: OfficeFormat, text: string): OfficeJob {
  requireSafe(text);
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let bytes: Buffer;
  if (format === "docx") {
    bytes = writeZip([
      { name: "[Content_Types].xml", data: Buffer.from(contentTypes('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>')) },
      { name: "_rels/.rels", data: Buffer.from(rels("word/document.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument")) },
      { name: "word/document.xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escaped}</w:t></w:r></w:p></w:body></w:document>`) },
    ]);
  } else if (format === "xlsx") {
    bytes = writeZip([
      { name: "[Content_Types].xml", data: Buffer.from(contentTypes('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')) },
      { name: "_rels/.rels", data: Buffer.from(rels("xl/workbook.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument")) },
      { name: "xl/workbook.xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>`) },
      { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(rels("worksheets/sheet1.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet")) },
      { name: "xl/worksheets/sheet1.xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${escaped}</t></is></c></row></sheetData></worksheet>`) },
    ]);
  } else if (format === "pptx") {
    bytes = writeZip([
      { name: "[Content_Types].xml", data: Buffer.from(contentTypes('<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>')) },
      { name: "_rels/.rels", data: Buffer.from(rels("ppt/presentation.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument")) },
      { name: "ppt/presentation.xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`) },
      { name: "ppt/_rels/presentation.xml.rels", data: Buffer.from(rels("slides/slide1.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide")) },
      { name: "ppt/slides/slide1.xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>${escaped}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`) },
    ]);
  } else {
    const stream = `BT /F1 12 Tf 72 720 Td <${utf16BeHex(text)}> Tj ET`;
    const body = Buffer.from(stream, "latin1");
    const objs = [
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
      `4 0 obj << /Length ${body.length} >> stream\n${stream}\nendstream endobj`,
      "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    ];
    let pdf = "%PDF-1.4\n";
    const xref: number[] = [0];
    for (const obj of objs) {
      xref.push(Buffer.byteLength(pdf, "latin1"));
      pdf += `${obj}\n`;
    }
    const start = Buffer.byteLength(pdf, "latin1");
    pdf += `xref\n0 ${xref.length}\n`;
    pdf += "0000000000 65535 f \n";
    for (const off of xref.slice(1)) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer << /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
    bytes = Buffer.from(pdf, "latin1");
  }
  return { id: `office-${format}`, format, bytes, text };
}

function primaryPart(format: Exclude<OfficeFormat, "pdf">): string {
  if (format === "docx") return "word/document.xml";
  if (format === "xlsx") return "xl/worksheets/sheet1.xml";
  return "ppt/slides/slide1.xml";
}

function spliceXmlText(xml: string, replacement: string): string {
  const escaped = replacement.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (xml.includes("</w:body>")) {
    return xml.replace(
      "</w:body>",
      `<w:p><w:r><w:t>${escaped}</w:t></w:r></w:p></w:body>`,
    );
  }
  if (xml.includes("</sheetData>")) {
    return xml.replace(
      "</sheetData>",
      `<row r="999"><c r="A999" t="inlineStr"><is><t>${escaped}</t></is></c></row></sheetData>`,
    );
  }
  if (xml.includes("</p:spTree>")) {
    return xml.replace(
      "</p:spTree>",
      `<p:sp><p:txBody><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>${escaped}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree>`,
    );
  }
  return `${xml}${escaped}`;
}

function editPdf(bytes: Buffer, replacement: string): OfficeJob {
  const raw = bytes.toString("latin1");
  const extra = `BT /F1 12 Tf 72 680 Td <${utf16BeHex(replacement)}> Tj ET`;
  const next = raw.includes("%%EOF")
    ? raw.replace("%%EOF", `${extra}\n%%EOF`)
    : `${raw}\n${extra}\n`;
  const out = Buffer.from(next, "latin1");
  return { id: "office-pdf", format: "pdf", bytes: out, text: inspect(out).text };
}

export function edit(bytes: Buffer, replacement: string): OfficeJob {
  requireSafe(replacement);
  const format = detect(bytes);
  if (format === "pdf") return editPdf(bytes, replacement);
  const entries = readZip(bytes);
  const target = primaryPart(format);
  const next = entries.map((entry) =>
    entry.name === target
      ? { name: entry.name, data: Buffer.from(spliceXmlText(entry.data.toString("utf8"), replacement), "utf8") }
      : { name: entry.name, data: Buffer.from(entry.data) },
  );
  const out = writeZip(next);
  return { id: `office-${format}`, format, bytes: out, text: inspect(out).text };
}

export function commit(job: OfficeJob): Buffer {
  return Buffer.from(job.bytes);
}

export function createOfficeService() {
  return {
    name: "@penglai/office",
    version: RELEASE,
    inspect,
    create: createDocument,
    edit,
    commit,
    status() {
      return { state: "active", formats: ["docx", "xlsx", "pptx", "pdf"] as const };
    },
    resourceSnapshot() {
      return {
        workers: 0,
        sockets: 0,
        timers: 0,
        remotes: 0,
        db: 0,
        modelSessions: 0,
        audioHandles: 0,
      };
    },
  };
}
