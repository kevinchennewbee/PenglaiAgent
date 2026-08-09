import fs from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { load } from "cheerio";
import { strToU8, unzipSync, zipSync } from "fflate";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_OFFICE_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_OFFICE_ENTRIES = 5_000;
const DEFAULT_MAX_CHARS = 60_000;
const SENSITIVE_SEGMENTS = new Set([".ssh", ".gnupg", ".aws", ".env", "credentials"]);

function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function hasSensitiveSegment(target: string): boolean {
  return target
    .split(/[\\/]+/)
    .some((segment) => SENSITIVE_SEGMENTS.has(segment.toLowerCase()) || /(?:^|[._-])(token|secret|private[_-]?key)(?:$|[._-])/i.test(segment));
}

export function resolveDocumentReadPath(workspaceRoot: string, inputPath: string): string {
  const root = fs.realpathSync(workspaceRoot);
  const candidate = path.isAbsolute(inputPath) ? inputPath : path.resolve(root, inputPath);
  const target = fs.realpathSync(candidate);
  if (!inside(root, target)) throw new Error("document path is outside the workspace");
  if (hasSensitiveSegment(target)) throw new Error("document path is sensitive and cannot be read");
  const stat = fs.statSync(target);
  if (!stat.isFile()) throw new Error("document path is not a regular file");
  if (stat.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`document is too large (${stat.size} bytes; limit ${MAX_DOCUMENT_BYTES})`);
  }
  return target;
}

export function resolveNewPdfPath(workspaceRoot: string, inputPath: string): string {
  const root = fs.realpathSync(workspaceRoot);
  const candidate = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(root, inputPath);
  if (path.extname(candidate).toLowerCase() !== ".pdf") throw new Error("output path must end in .pdf");
  if (fs.existsSync(candidate)) throw new Error("refusing to overwrite an existing PDF; choose a new path");
  const parent = fs.realpathSync(path.dirname(candidate));
  if (!inside(root, parent)) throw new Error("PDF output path is outside the workspace");
  if (hasSensitiveSegment(candidate)) throw new Error("PDF output path is sensitive");
  return candidate;
}

const CREATABLE_DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".pptx"]);

export function resolveNewDocumentPath(workspaceRoot: string, inputPath: string): string {
  const root = fs.realpathSync(workspaceRoot);
  const candidate = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(root, inputPath);
  const extension = path.extname(candidate).toLowerCase();
  if (!CREATABLE_DOCUMENT_EXTENSIONS.has(extension)) {
    throw new Error("output path must end in .pdf, .docx, .xlsx, or .pptx");
  }
  if (fs.existsSync(candidate)) throw new Error("refusing to overwrite an existing document; choose a new path");
  const parent = fs.realpathSync(path.dirname(candidate));
  if (!inside(root, parent)) throw new Error("document output path is outside the workspace");
  if (hasSensitiveSegment(candidate)) throw new Error("document output path is sensitive");
  return candidate;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function writeZipDocument(target: string, files: Record<string, Uint8Array>): { path: string; bytes: number } {
  const bytes = Buffer.from(zipSync(files, { level: 6 }));
  fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
  return { path: target, bytes: bytes.byteLength };
}

function contentParagraphs(content: string): string[] {
  return content
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd());
}

function createDocx(target: string, title: string | undefined, content: string): { path: string; bytes: number; pages?: number } {
  const rows = [...(title?.trim() ? [title.trim(), ""] : []), ...contentParagraphs(content)];
  const paragraphs = rows.map((line, index) => {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const text = heading?.[2] ?? line.replace(/^[-*]\s+/, "• ");
    const style = heading || (index === 0 && title?.trim())
      ? `<w:pPr><w:pStyle w:val="${heading ? `Heading${heading[1].length}` : "Title"}"/></w:pPr>`
      : "";
    return `<w:p>${style}<w:r><w:t xml:space="preserve">${xmlEscape(text || " ")}</w:t></w:r></w:p>`;
  }).join("");
  return writeZipDocument(target, {
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/_rels/document.xml.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    "word/styles.xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style></w:styles>'),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`),
  });
}

function excelColumn(index: number): string {
  let value = index + 1;
  let out = "";
  while (value > 0) {
    value -= 1;
    out = String.fromCharCode(65 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return out;
}

function createXlsx(target: string, content: string): { path: string; bytes: number; pages?: number } {
  const lines = contentParagraphs(content).filter((line) => line.length > 0);
  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : ",";
  const rows = lines.map((line) => line.split(delimiter));
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => `<c r="${excelColumn(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell)}</t></is></c>`).join("")}</row>`).join("");
  return writeZipDocument(target, {
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/workbook.xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`),
  });
}

function createPptx(target: string, title: string | undefined, content: string): { path: string; bytes: number; pages: number } {
  const sections = content.replace(/\r/g, "").split(/\n(?=#\s+)/g).map((part) => part.trim()).filter(Boolean);
  const slides = (sections.length ? sections : [content]).map((section, index) => {
    const lines = section.split("\n");
    const heading = lines[0]?.match(/^#\s+(.+)$/)?.[1] ?? (index === 0 ? title?.trim() : undefined) ?? `Slide ${index + 1}`;
    const body = (lines[0]?.startsWith("# ") ? lines.slice(1) : lines).join("\n").trim();
    return { heading, body };
  });
  const files = new Map<string, Uint8Array>([
    ["[Content_Types].xml", strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slides.map((_slide, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`)],
    ["_rels/.rels", strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>')],
    ["ppt/presentation.xml", strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${slides.map((_slide, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`)],
    ["ppt/_rels/presentation.xml.rels", strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_slide, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("")}</Relationships>`)],
  ]);
  slides.forEach((slide, index) => {
    const shape = (id: number, name: string, text: string, y: number, h: number, size: number) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="${y}"/><a:ext cx="10820400" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="${size}"/><a:t>${xmlEscape(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
    files.set(`ppt/slides/slide${index + 1}.xml`, strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shape(2, "Title", slide.heading, 685800, 1143000, 3000)}${shape(3, "Body", slide.body || " ", 2057400, 3886200, 1800)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`));
  });
  const result = writeZipDocument(target, Object.fromEntries(files));
  return { ...result, pages: slides.length };
}

async function readPdf(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const pdf = await task.promise;
  const pages: string[] = [];
  try {
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push(`## Page ${index}\n${text}`);
    }
  } finally {
    await task.destroy();
  }
  return pages.join("\n\n");
}

function assertOfficeZipBounds(buffer: Buffer): void {
  let entries = 0;
  let total = 0;
  for (let offset = 0; offset + 46 <= buffer.length;) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const size = buffer.readUInt32LE(offset + 24);
    if (size === 0xffffffff) throw new Error("ZIP64 Office documents are not supported");
    total += size;
    entries += 1;
    if (entries > MAX_OFFICE_ENTRIES || total > MAX_OFFICE_UNCOMPRESSED_BYTES) {
      throw new Error("Office document expands beyond the safe ZIP limit");
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (entries === 0) throw new Error("Office document has no valid ZIP directory");
}

function unzipOffice(buffer: Buffer): Map<string, Uint8Array> {
  assertOfficeZipBounds(buffer);
  const entries = Object.entries(unzipSync(new Uint8Array(buffer)));
  const total = entries.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0);
  if (entries.length > MAX_OFFICE_ENTRIES || total > MAX_OFFICE_UNCOMPRESSED_BYTES) {
    throw new Error("Office document expands beyond the safe ZIP limit");
  }
  return new Map(entries);
}

function xmlText(bytes: Uint8Array | undefined, label: string): string {
  if (!bytes) throw new Error(`Office document is missing ${label}`);
  return new TextDecoder().decode(bytes);
}

function readDocx(buffer: Buffer): string {
  const files = unzipOffice(buffer);
  const doc = load(xmlText(files.get("word/document.xml"), "word/document.xml"), { xmlMode: true });
  return doc("w\\:p, p")
    .map((_i, paragraph) => doc(paragraph).find("w\\:t, t").map((_j, text) => doc(text).text()).get().join(""))
    .get()
    .filter((line) => line.trim())
    .join("\n")
    .trim();
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "A";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function readXlsx(buffer: Buffer): string {
  const files = unzipOffice(buffer);
  const shared: string[] = [];
  if (files.has("xl/sharedStrings.xml")) {
    const strings = load(xmlText(files.get("xl/sharedStrings.xml"), "xl/sharedStrings.xml"), { xmlMode: true });
    strings("si").each((_i, item) => {
      shared.push(strings(item).find("t").map((_j, text) => strings(text).text()).get().join(""));
    });
  }

  const relationships = new Map<string, string>();
  const rels = load(xmlText(files.get("xl/_rels/workbook.xml.rels"), "xl/_rels/workbook.xml.rels"), { xmlMode: true });
  rels("Relationship").each((_i, element) => {
    const id = rels(element).attr("Id") ?? "";
    const target = rels(element).attr("Target") ?? "";
    if (id && target && !/^[a-z]+:/i.test(target)) {
      const normalized = target.startsWith("/")
        ? target.slice(1)
        : path.posix.normalize(path.posix.join("xl", target));
      if (/^xl\/worksheets\/[A-Za-z0-9._-]+\.xml$/.test(normalized)) {
        relationships.set(id, normalized);
      }
    }
  });

  const workbook = load(xmlText(files.get("xl/workbook.xml"), "xl/workbook.xml"), { xmlMode: true });
  const lines: string[] = [];
  workbook("sheet").each((_i, sheet) => {
    const name = workbook(sheet).attr("name") ?? "Sheet";
    const relationId = workbook(sheet).attr("r:id") ?? "";
    const target = relationships.get(relationId);
    if (!target || !files.has(target)) return;
    const worksheet = load(xmlText(files.get(target), target), { xmlMode: true });
    lines.push(`# Sheet: ${name}`);
    worksheet("row").each((_rowIndex, row) => {
      const values = new Map<number, string>();
      let maxColumn = -1;
      worksheet(row).find("c").each((_cellIndex, cell) => {
        const reference = worksheet(cell).attr("r") ?? "A1";
        const index = columnIndex(reference);
        const type = worksheet(cell).attr("t") ?? "";
        const raw = worksheet(cell).find("v").first().text();
        const value = type === "s"
          ? shared[Number(raw)] ?? ""
          : type === "inlineStr"
            ? worksheet(cell).find("is t").map((_j, text) => worksheet(text).text()).get().join("")
            : type === "b"
              ? raw === "1" ? "TRUE" : "FALSE"
              : raw;
        values.set(index, value);
        maxColumn = Math.max(maxColumn, index);
      });
      lines.push(Array.from({ length: maxColumn + 1 }, (_unused, index) => values.get(index) ?? "").join("\t").replace(/\s+$/g, ""));
    });
    lines.push("");
  });
  return lines.join("\n").trim();
}

function readPptx(buffer: Buffer): string {
  const files = unzipOffice(buffer);
  const slideNames = [...files.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
  return slideNames
    .map((name, index) => {
      const doc = load(xmlText(files.get(name), name), { xmlMode: true });
      const texts = doc("a\\:t, t")
        .map((_i, element) => doc(element).text())
        .get()
        .map((text) => text.trim())
        .filter(Boolean);
      return `## Slide ${index + 1}\n${texts.join("\n")}`;
    })
    .join("\n\n");
}

function readTextLike(buffer: Buffer, extension: string): string {
  const decoded = buffer.toString("utf8");
  if (extension === ".html" || extension === ".htm") {
    const doc = load(decoded);
    doc("script,style,noscript").remove();
    return doc("body").text().replace(/[\t ]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  }
  if (extension === ".rtf") {
    return decoded
      .replace(/\\'[0-9a-fA-F]{2}/g, "")
      .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
      .replace(/[{}]/g, "")
      .trim();
  }
  return decoded.trim();
}

export async function readDocument(
  workspaceRoot: string,
  inputPath: string,
  maxChars = DEFAULT_MAX_CHARS,
): Promise<{ path: string; format: string; text: string; truncated: boolean }> {
  const target = resolveDocumentReadPath(workspaceRoot, inputPath);
  const extension = path.extname(target).toLowerCase();
  const buffer = fs.readFileSync(target);
  let text: string;
  if (extension === ".pdf") text = await readPdf(buffer);
  else if (extension === ".docx") text = readDocx(buffer);
  else if (extension === ".xlsx") text = readXlsx(buffer);
  else if (extension === ".pptx") text = readPptx(buffer);
  else if ([".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml", ".html", ".htm", ".rtf"].includes(extension)) {
    text = readTextLike(buffer, extension);
  } else {
    throw new Error(`unsupported document format '${extension || "(none)"}'`);
  }
  const limit = Math.max(1_000, Math.min(200_000, Math.floor(maxChars)));
  const truncated = text.length > limit;
  return { path: target, format: extension.slice(1), text: truncated ? text.slice(0, limit) : text, truncated };
}

function findPdfFont(): string {
  const candidates = [
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttf",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttf",
    "C:\\Windows\\Fonts\\msyh.ttf",
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("no supported Unicode system font found for PDF generation");
  return found;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const rows: string[] = [];
  let current = "";
  for (const character of [...text]) {
    const candidate = current + character;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      rows.push(current.trimEnd());
      current = character.trimStart();
    } else {
      current = candidate;
    }
  }
  if (current || rows.length === 0) rows.push(current);
  return rows;
}

export async function createPdfDocument(
  workspaceRoot: string,
  input: { path: string; title?: string; content: string },
): Promise<{ path: string; bytes: number; pages: number }> {
  if (!input.content.trim()) throw new Error("PDF content is empty");
  if (input.content.length > 500_000) throw new Error("PDF content exceeds 500,000 characters");
  const target = resolveNewPdfPath(workspaceRoot, input.path);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(fs.readFileSync(findPdfFont()), { subset: true });
  document.setTitle(input.title?.trim() || path.basename(target));
  document.setProducer("Penglai 0.4 document broker");

  const width = 595.28;
  const height = 841.89;
  const marginX = 58;
  const marginTop = 54;
  const marginBottom = 54;
  let page!: PDFPage;
  let cursorY = height - marginTop;
  const addPage = () => {
    page = document.addPage([width, height]);
    cursorY = height - marginTop;
  };
  addPage();

  type BlockOptions = { size: number; color: ReturnType<typeof rgb>; indent?: number; after?: number; lineGap?: number };
  const measureBlock = (text: string, options: Omit<BlockOptions, "color">): number => {
    const indent = options.indent ?? 0;
    const maxWidth = width - marginX * 2 - indent;
    const lineHeight = options.size * 1.35 + (options.lineGap ?? 0);
    return wrapText(text, font, options.size, maxWidth).length * lineHeight + (options.after ?? 0);
  };
  const writeBlock = (text: string, options: BlockOptions) => {
    const indent = options.indent ?? 0;
    const maxWidth = width - marginX * 2 - indent;
    const lineHeight = options.size * 1.35 + (options.lineGap ?? 0);
    const lines = wrapText(text, font, options.size, maxWidth);
    const blockHeight = lines.length * lineHeight + (options.after ?? 0);
    const usableHeight = height - marginTop - marginBottom;
    if (blockHeight <= usableHeight && cursorY - blockHeight < marginBottom) addPage();
    for (const line of lines) {
      if (cursorY - lineHeight < marginBottom) addPage();
      cursorY -= lineHeight;
      page.drawText(line || " ", { x: marginX + indent, y: cursorY, size: options.size, font, color: options.color });
    }
    cursorY -= options.after ?? 0;
  };

  if (input.title?.trim()) {
    writeBlock(input.title.trim(), { size: 20, color: rgb(0.12, 0.16, 0.22), after: 16 });
  }
  const contentLines = input.content.replace(/\r/g, "").split("\n");
  const measureContentLine = (rawLine: string): number => {
    const line = rawLine.trimEnd();
    if (!line) return 8;
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const size = [18, 15, 13][heading[1].length - 1] ?? 13;
      return measureBlock(heading[2], { size, after: 10 });
    }
    if (/^[-*]\s+/.test(line)) {
      return measureBlock(`• ${line.replace(/^[-*]\s+/, "")}`, { size: 11, indent: 12, after: 4 });
    }
    return measureBlock(line, { size: 11, after: 7, lineGap: 3 });
  };
  for (let lineIndex = 0; lineIndex < contentLines.length; lineIndex += 1) {
    const rawLine = contentLines[lineIndex] ?? "";
    const line = rawLine.trimEnd();
    if (!line) {
      cursorY -= 8;
      if (cursorY < marginBottom) addPage();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const size = [18, 15, 13][heading[1].length - 1] ?? 13;
      let sectionHeight = 0;
      for (let lookahead = lineIndex; lookahead < contentLines.length; lookahead += 1) {
        const candidate = contentLines[lookahead] ?? "";
        if (lookahead > lineIndex && /^(#{1,3})\s+/.test(candidate.trimEnd())) break;
        sectionHeight += measureContentLine(candidate);
      }
      const usableHeight = height - marginTop - marginBottom;
      if (sectionHeight <= usableHeight && cursorY - sectionHeight < marginBottom) addPage();
      writeBlock(heading[2], { size, color: rgb(0.12, 0.16, 0.22), after: 10 });
    } else if (/^[-*]\s+/.test(line)) {
      writeBlock(`• ${line.replace(/^[-*]\s+/, "")}`, { size: 11, color: rgb(0.22, 0.25, 0.32), indent: 12, after: 4 });
    } else {
      writeBlock(line, { size: 11, color: rgb(0.22, 0.25, 0.32), after: 7, lineGap: 3 });
    }
  }

  const bytes = await document.save({ useObjectStreams: false });
  fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
  return { path: target, bytes: bytes.byteLength, pages: document.getPageCount() };
}

export async function createOfficeDocument(
  workspaceRoot: string,
  input: { path: string; title?: string; content: string },
): Promise<{ path: string; format: string; bytes: number; pages?: number }> {
  if (!input.content.trim()) throw new Error("document content is empty");
  if (input.content.length > 500_000) throw new Error("document content exceeds 500,000 characters");
  const target = resolveNewDocumentPath(workspaceRoot, input.path);
  const extension = path.extname(target).toLowerCase();
  if (extension === ".pdf") {
    const result = await createPdfDocument(workspaceRoot, input);
    return { ...result, format: "pdf" };
  }
  const result = extension === ".docx"
    ? createDocx(target, input.title, input.content)
    : extension === ".xlsx"
      ? createXlsx(target, input.content)
      : createPptx(target, input.title, input.content);
  return { ...result, format: extension.slice(1) };
}
