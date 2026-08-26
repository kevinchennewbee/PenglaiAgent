/** Rewrite of DSH-IM `src/channels/qq/markdown-reply.mjs` at ea5176be (not v3.0.0). MIT ideas only. */

const DEFAULT_LIMIT = 4_500;
const MARKDOWN_REJECTION_CODES = new Set([40_034_090]);
const CODE_FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const GFM_TABLE_LINE = /^\|.+\|$/;

export interface MarkdownChunk {
  markdown: string;
  plain: string;
}

export function isMarkdownRejection(error: unknown): boolean {
  const rec = error && typeof error === "object" ? (error as { code?: unknown; message?: unknown }) : {};
  const code = Number(rec.code);
  if (MARKDOWN_REJECTION_CODES.has(code)) return true;
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /40034090|markdown rejected|markdown not support/i.test(text);
}

function openingFence(line: string): { delimiter: string; info: string; indent: number } | null {
  const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
  const match = CODE_FENCE_OPEN.exec(normalized);
  if (!match) return null;
  const delimiter = match[2] ?? "";
  const info = match[3] ?? "";
  if (delimiter.startsWith("`") && info.includes("`")) return null;
  return { delimiter, info, indent: match[1]?.length ?? 0 };
}

function closesFence(line: string, opening: { delimiter: string }): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return Boolean(
    match && match[1]?.[0] === opening.delimiter[0] && (match[1]?.length ?? 0) >= opening.delimiter.length,
  );
}

export function chunkMarkdownText(text: string, limit = DEFAULT_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";
  let fence: { delimiter: string; info: string; indent: number } | null = null;
  let table = false;
  const flush = () => {
    const next = current.replace(/\n+$/u, "");
    if (next) chunks.push(next);
    current = "";
    table = false;
  };
  const pushLine = (line: string) => {
    current = current ? `${current}\n${line}` : line;
  };
  for (const line of lines) {
    const open: ReturnType<typeof openingFence> = !fence ? openingFence(line) : null;
    const inTable = table || (!fence && GFM_TABLE_LINE.test(line));
    const startingFence = Boolean(open);
    const candidate = current ? `${current}\n${line}` : line;
    if (startingFence && current && candidate.length > limit) flush();
    if (inTable && !table && current && candidate.length > limit) flush();
    if (open) fence = open;
    else if (fence && closesFence(line, fence)) fence = null;
    if (!fence && GFM_TABLE_LINE.test(line)) table = true;
    else if (table && line.trim() === "") table = false;
    if (!current || candidate.length <= limit || fence || table) {
      pushLine(line);
      continue;
    }
    flush();
    pushLine(line);
  }
  flush();
  return chunks.length ? chunks : [text.slice(0, limit)];
}

export function nextMessageSeq(previous: number): number {
  if (!Number.isSafeInteger(previous) || previous < 0) return 1;
  return previous + 1;
}

export function markdownPayload(content: string, seq: number): { msgType: 2; markdown: { content: string }; extra: { msg_seq: number } } {
  return { msgType: 2, markdown: { content }, extra: { msg_seq: seq } };
}

export function plainPayload(content: string, seq: number): { msgType: 0; content: string; extra: { msg_seq: number } } {
  return { msgType: 0, content, extra: { msg_seq: seq } };
}
