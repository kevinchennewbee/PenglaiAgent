/** Rewrite of DSH-IM `src/channels/qq/markdown-reply.mjs` now inside v3.0.1. MIT ideas only. */

const DEFAULT_LIMIT = 4_500;
const MARKDOWN_REJECTION_CODES = new Set([40_034_090]);
const CODE_FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const GFM_TABLE_LINE = /^\|.+\|$/;
/** DSH-IM v3.0.1 C2C passive-reply quota. Penglai is private-only, so no group quota. */
export const QQ_C2C_PASSIVE_REPLY_LIMIT = 4;
export const QQ_PARTIAL_REPLY_NOTICE =
  "回答较长，后续内容未能通过 QQ 完整发送，请回复“继续”。";

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

export function safeSliceIndex(value: string, limit: number): number {
  let index = Math.min(limit, value.length);
  const before = value.charCodeAt(index - 1);
  const after = value.charCodeAt(index);
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
    index -= 1;
  }
  return Math.max(1, index);
}

export function applyC2cPassiveQuota(
  chunks: string[],
  limit = QQ_C2C_PASSIVE_REPLY_LIMIT,
): { chunks: string[]; truncated: boolean } {
  if (chunks.length <= limit) return { chunks, truncated: false };
  return {
    chunks: [...chunks.slice(0, Math.max(0, limit - 1)), QQ_PARTIAL_REPLY_NOTICE],
    truncated: true,
  };
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
      if (!fence && !table) {
        while (current.length > limit) {
          const index = safeSliceIndex(current, limit);
          chunks.push(current.slice(0, index));
          current = current.slice(index);
        }
      }
      continue;
    }
    flush();
    if (line.length > limit) {
      let remaining = line;
      while (remaining.length > limit) {
        const index = safeSliceIndex(remaining, limit);
        chunks.push(remaining.slice(0, index));
        remaining = remaining.slice(index);
      }
      current = remaining;
      continue;
    }
    pushLine(line);
  }
  flush();
  return chunks.length ? chunks : [text.slice(0, safeSliceIndex(text, limit))];
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
