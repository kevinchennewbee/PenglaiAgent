import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { readZip, writeZip } from "../zip.js";
import { assertAuthorizedBytes } from "../authorization.js";

const require = createRequire(import.meta.url);

function pptfastGenerate(): ((input: unknown) => Promise<Uint8Array>) | undefined {
  try {
    const pkg = dirname(require.resolve("@liustack/pptfast/package.json"));
    const loaded = require(join(pkg, "dist/index.js")) as { generatePptx?: (input: unknown) => Promise<Uint8Array> };
    return loaded.generatePptx;
  } catch {
    return undefined;
  }
}

function xmlText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackPptx(text: string): Buffer {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`;
  const presentation = `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`;
  const presRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`;
  const slide = `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>${escaped}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  return writeZip([
    { name: "[Content_Types].xml", data: Buffer.from(types) },
    { name: "_rels/.rels", data: Buffer.from(rels) },
    { name: "ppt/presentation.xml", data: Buffer.from(presentation) },
    { name: "ppt/_rels/presentation.xml.rels", data: Buffer.from(presRels) },
    { name: "ppt/slides/slide1.xml", data: Buffer.from(slide) },
  ]);
}

export async function createPptx(text: string): Promise<Buffer> {
  const generatePptx = pptfastGenerate();
  if (generatePptx) {
    try {
      const bytes = await generatePptx({
        filename: "penglai.pptx",
        theme: { id: "consulting" },
        slides: [
          { type: "cover", heading: text.slice(0, 80), subheading: "Penglai Office" },
          { type: "ending", heading: text.slice(0, 80) },
        ],
      });
      return Buffer.from(bytes);
    } catch {
      return fallbackPptx(text);
    }
  }
  return fallbackPptx(text);
}

export async function inspectPptx(bytes: Buffer): Promise<{ text: string; parts: string[] }> {
  assertAuthorizedBytes(bytes);
  const entries = readZip(bytes);
  const xml = entries
    .filter((entry) => entry.name.endsWith(".xml"))
    .map((entry) => xmlText(entry.data.toString("utf8")))
    .filter(Boolean)
    .join(" ");
  return { text: xml, parts: entries.map((entry) => entry.name) };
}

export function editPptx(bytes: Buffer, replacement: string): Buffer {
  assertAuthorizedBytes(bytes);
  const escaped = replacement.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const entries = readZip(bytes);
  let patched = false;
  const next = entries.map((entry) => {
    if (!entry.name.includes("ppt/slides/slide") || !entry.name.endsWith(".xml")) {
      return { name: entry.name, data: Buffer.from(entry.data) };
    }
    if (patched) return { name: entry.name, data: Buffer.from(entry.data) };
    const xml = entry.data.toString("utf8");
    const withText = xml.includes("</p:spTree>")
      ? xml.replace(
          "</p:spTree>",
          `<p:sp><p:txBody><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>${escaped}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree>`,
        )
      : `${xml}${escaped}`;
    patched = true;
    return { name: entry.name, data: Buffer.from(withText, "utf8") };
  });
  return writeZip(next);
}

export function pptfastModulePath(): string {
  return fileURLToPath(new URL("../../node_modules/@liustack/pptfast/package.json", import.meta.url));
}
