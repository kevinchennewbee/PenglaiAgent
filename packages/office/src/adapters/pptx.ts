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
    try {
      const nodePlatform = require(join(pkg, "dist/node.js")) as { installNodePlatform?: () => void };
      nodePlatform.installNodePlatform?.();
    } catch {
      /* browser/electron already have DOMParser */
    }
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

export async function createPptx(text: string): Promise<Buffer> {
  const generatePptx = pptfastGenerate();
  if (!generatePptx) {
    throw new PenglaiError("DSH_UNAVAILABLE", "pptx create requires @liustack/pptfast; homemade OOXML zip is not shipped");
  }
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
  } catch (error) {
    throw new PenglaiError("INVALID_INPUT", `pptx create failed: ${error instanceof Error ? error.message : "pptfast"}`);
  }
}

export async function inspectPptx(bytes: Buffer): Promise<{ text: string; parts: string[]; slides: string[] }> {
  assertAuthorizedBytes(bytes);
  const entries = readZip(bytes);
  const slides = entries
    .filter((entry) => /ppt\/slides\/slide\d+\.xml$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((entry) => xmlText(entry.data.toString("utf8")));
  return {
    text: slides.join(" "),
    parts: [...entries.map((entry) => entry.name), ...slides.map((text, index) => `slide${index}:${text.slice(0, 80)}`)],
    slides,
  };
}

export function editPptx(bytes: Buffer, op: { slideIndex: number; text: string }): Buffer {
  assertAuthorizedBytes(bytes);
  const escaped = op.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const entries = readZip(bytes);
  const slideNames = entries
    .map((entry) => entry.name)
    .filter((name) => /ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const target = slideNames[op.slideIndex];
  if (!target) throw new PenglaiError("INVALID_INPUT", "pptx slide index out of range");
  let patched = false;
  const next = entries.map((entry) => {
    if (entry.name !== target) return { name: entry.name, data: Buffer.from(entry.data) };
    const xml = entry.data.toString("utf8");
    if (!/<a:t[\s>]/.test(xml)) {
      throw new PenglaiError("INVALID_INPUT", "pptx slide has no text run; complex edit is not supported in 0.5.5");
    }
    patched = true;
    return {
      name: entry.name,
      data: Buffer.from(xml.replace(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>/, `<a:t>${escaped}</a:t>`), "utf8"),
    };
  });
  if (!patched) throw new PenglaiError("INVALID_INPUT", "pptx slide missing");
  return writeZip(next);
}

export function pptfastModulePath(): string {
  return fileURLToPath(new URL("../../node_modules/@liustack/pptfast/package.json", import.meta.url));
}
