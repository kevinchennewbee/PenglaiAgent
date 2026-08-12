/**
 * Deterministic local chunking for Personal Context V1.
 * No model calls — title/heading boundaries first, then window oversized paragraphs.
 * Every chunk carries at least one interpretable location (R12):
 * - markdown/text: headingPath (or offset when no heading)
 * - spreadsheet (csv/tsv): sheet + row group + header-derived heading
 * - structured (json/yaml/xml): offsetStart/offsetEnd key-path best effort
 */

const DEFAULT_MAX_CHARS = 1_200;
const DEFAULT_OVERLAP = 100;

export type ChunkKind = "markdown" | "spreadsheet" | "structured" | "plain";

export interface ChunkLocation {
  headingPath?: string | null;
  sheet?: string | null;
  rowStart?: number | null;
  rowEnd?: number | null;
  keyPath?: string | null;
  offsetStart?: number | null;
  offsetEnd?: number | null;
}

export interface TextChunk {
  ordinal: number;
  headingPath: string | null;
  text: string;
  tokenEstimate: number;
  location?: ChunkLocation | null;
}

function estimateTokens(text: string): number {
  // Rough CJK+latin mix estimate: ~2 chars / token for mixed Chinese docs.
  return Math.max(1, Math.ceil(text.length / 2));
}

function splitMarkdownish(text: string): Array<{ heading: string | null; body: string }> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: Array<{ heading: string | null; body: string }> = [];
  let heading: string | null = null;
  let buf: string[] = [];
  const flush = (): void => {
    const body = buf.join("\n").trim();
    if (body) sections.push({ heading, body });
    buf = [];
  };
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+)$/.exec(line);
    if (m) {
      flush();
      heading = m[2]!.trim();
      continue;
    }
    buf.push(line);
  }
  flush();
  if (sections.length === 0 && text.trim()) {
    sections.push({ heading: null, body: text.trim() });
  }
  return sections;
}

function windowText(text: string, maxChars: number, overlap: number): string[] {
  if (text.length <= maxChars) return [text];
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + maxChars);
    out.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(0, end - overlap);
  }
  return out;
}

/**
 * CSV/TSV: keep sheet + header context and row groups instead of headerless text.
 * We cannot reliably know the sheet name from plain text, so we synthesize a
 * stable "sheet" label from the first row (the header) and record row ranges.
 */
function splitSpreadsheet(text: string): Array<{ header: string | null; rows: string[] }> {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0] ?? null;
  const out: Array<{ header: string | null; rows: string[] }> = [];
  const groupSize = 40;
  for (let i = 1; i < lines.length; i += groupSize) {
    out.push({ header, rows: lines.slice(i, i + groupSize) });
  }
  if (out.length === 0) out.push({ header, rows: [] });
  return out;
}

function isJsonLike(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

function isYamlLike(text: string): boolean {
  const t = text.trimStart();
  return /^[a-zA-Z_][\w.-]*\s*:/.test(t);
}

function isXmlLike(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("<") && /<\/?[a-zA-Z][^>]*>/.test(t);
}

/**
 * Best-effort key path for the first meaningful line of structured content.
 * Not a full parser — just an interpretable location anchor for the chunk.
 */
function keyPathFor(text: string): string | null {
  const first = text.split("\n").find((line) => line.trim());
  if (!first) return null;
  const t = first.trim().replace(/[,:\[\]{}"]/g, "").replace(/\s+/g, "_");
  return t.slice(0, 60) || null;
}

export function chunkDocumentText(
  text: string,
  options: { maxChars?: number; overlap?: number; kind?: ChunkKind } = {},
): TextChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const kind = options.kind ?? (isJsonLike(text) || isYamlLike(text) || isXmlLike(text) ? "structured" : "markdown");
  const chunks: TextChunk[] = [];
  let ordinal = 0;

  if (kind === "spreadsheet") {
    for (const group of splitSpreadsheet(text)) {
      const joined = [group.header ? `## ${group.header}` : null, ...group.rows]
        .filter(Boolean)
        .join("\n");
      if (!joined.trim()) continue;
      chunks.push({
        ordinal,
        headingPath: group.header,
        text: joined.trim(),
        tokenEstimate: estimateTokens(joined),
        location: {
          headingPath: group.header,
          sheet: "sheet1",
          rowStart: ordinal * 40 + 1,
          rowEnd: ordinal * 40 + 1 + group.rows.length - 1,
        },
      });
      ordinal += 1;
    }
    return chunks;
  }

  if (kind === "structured") {
    const keyPath = keyPathFor(text);
    const windows = windowText(text, maxChars, overlap);
    for (const window of windows) {
      const trimmed = window.trim();
      if (!trimmed) continue;
      const start = text.indexOf(trimmed);
      chunks.push({
        ordinal,
        headingPath: keyPath,
        text: trimmed,
        tokenEstimate: estimateTokens(trimmed),
        location: {
          keyPath,
          offsetStart: start >= 0 ? start : null,
          offsetEnd: start >= 0 ? start + trimmed.length : null,
        },
      });
      ordinal += 1;
    }
    return chunks;
  }

  // markdown / plain text
  const sections = splitMarkdownish(text);
  for (const section of sections) {
    const windows = windowText(section.body, maxChars, overlap);
    for (const window of windows) {
      const trimmed = window.trim();
      if (!trimmed) continue;
      const start = text.indexOf(trimmed);
      chunks.push({
        ordinal,
        headingPath: section.heading,
        text: trimmed,
        tokenEstimate: estimateTokens(trimmed),
        location: section.heading
          ? { headingPath: section.heading }
          : { offsetStart: start >= 0 ? start : null, offsetEnd: start >= 0 ? start + trimmed.length : null },
      });
      ordinal += 1;
    }
  }
  return chunks;
}
