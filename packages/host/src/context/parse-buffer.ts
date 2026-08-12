/**
 * Parse office/document buffers for Context indexing without a second path open.
 * Reuses the same algorithms as capabilities/documents.ts but operates on bytes.
 */

import { load as loadHtml } from "cheerio";
import { unzipSync } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

async function readPdf(buffer: Buffer): Promise<string> {
  const data = new Uint8Array(buffer);
  const loadingTask = getDocument({ data, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) pages.push(`## Page ${i}\n${text}`);
  }
  return pages.join("\n\n");
}

function readDocx(buffer: Buffer): string {
  const files = unzipSync(new Uint8Array(buffer));
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("docx missing word/document.xml");
  const doc = loadHtml(Buffer.from(xml).toString("utf8"), {
    xml: true,
  });
  return doc("w\\:t, t")
    .map((_i, el) => doc(el).text())
    .get()
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function readXlsx(buffer: Buffer): string {
  const files = unzipSync(new Uint8Array(buffer));
  const shared: string[] = [];
  const sharedXml = files["xl/sharedStrings.xml"];
  if (sharedXml) {
    const doc = loadHtml(Buffer.from(sharedXml).toString("utf8"), { xml: true });
    doc("si").each((_i, el) => {
      shared.push(doc(el).text());
    });
  }
  const sheets = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort();
  const out: string[] = [];
  for (const sheetName of sheets) {
    const sheetXml = files[sheetName];
    if (!sheetXml) continue;
    const doc = loadHtml(Buffer.from(sheetXml).toString("utf8"), { xml: true });
    const rows: string[] = [];
    doc("row").each((_ri, row) => {
      const cells: string[] = [];
      doc(row)
        .find("c")
        .each((_ci, cell) => {
          const type = doc(cell).attr("t");
          // shared string
          const v = doc(cell).find("v").first().text();
          if (type === "s") {
            const idx = Number(v);
            cells.push(shared[idx] ?? "");
          } else if (type === "inlineStr") {
            // inline string (<is><t>…</t></is>)
            cells.push(doc(cell).find("t").first().text());
          } else {
            cells.push(v);
          }
        });
      if (cells.some((c) => c.trim())) rows.push(cells.join("\t"));
    });
    const label = sheetName.replace(/^xl\/worksheets\//, "").replace(/\.xml$/, "");
    const display = label.replace(/^sheet(\d+)$/i, "Sheet$1");
    if (rows.length > 0) {
      out.push(`## ${display}\n${rows.join("\n")}`);
    }
  }
  return out.join("\n\n");
}

function readPptx(buffer: Buffer): string {
  const files = unzipSync(new Uint8Array(buffer));
  const slides = Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return slides
    .map((name, index) => {
      const xml = files[name];
      if (!xml) return "";
      const doc = loadHtml(Buffer.from(xml).toString("utf8"), { xml: true });
      const texts: string[] = [];
      doc("a\\:t").each((_i, element) => {
        const text = doc(element).text().trim();
        if (text) texts.push(text);
      });
      if (texts.length === 0) {
        // Fallback: any <t> element (some generators omit the a: namespace).
        doc("t").each((_i, element) => {
          const text = doc(element).text().trim();
          if (text) texts.push(text);
        });
      }
      return `## Slide ${index + 1}\n${texts.join("\n")}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export async function readDocumentFromBuffer(
  buffer: Buffer,
  extension: string,
): Promise<string> {
  const ext = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  if (ext === ".pdf") return readPdf(buffer);
  if (ext === ".docx") return readDocx(buffer);
  if (ext === ".xlsx") return readXlsx(buffer);
  if (ext === ".pptx") return readPptx(buffer);
  throw new Error(`unsupported document format '${ext}' for buffer parse`);
}
