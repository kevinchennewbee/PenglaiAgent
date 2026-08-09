/**
 * User-facing output cleanup (0.4 Host port of penglai_runtime/output_cleaner).
 *
 * Keeps chat / IM / transcript free of model protocol tags while still allowing
 * the UI to show thinking as a separate collapsible activity stream.
 */

const INTERNAL_TAGS = ["think", "thinking", "summary", "tool_use", "file_content"] as const;
const TAG_NAMES = INTERNAL_TAGS.join("|");
const TAG_RE = new RegExp(`<(${TAG_NAMES})(?:\\s[^>]*)?>[\\s\\S]*?</\\1>`, "gi");
const OPEN_TAG_RE = new RegExp(`<(?:${TAG_NAMES})(?:\\s[^>]*)?>`, "i");
const CLOSE_TAG_RE = new RegExp(`</(?:${TAG_NAMES})>`, "gi");
const THINK_BLOCK_RE = /<(think|thinking)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;

export type SplitModelText = {
  /** Answer text safe for the user bubble. */
  result: string;
  /** Concatenated thinking blocks (may be empty). */
  thinking: string;
};

function stripInternalMarkup(text: string): string {
  let value = String(text ?? "");
  let prev: string | null = null;
  while (prev !== value) {
    prev = value;
    value = value.replace(TAG_RE, "");
  }
  const open = OPEN_TAG_RE.exec(value);
  if (open && open.index !== undefined) {
    value = value.slice(0, open.index);
  }
  value = value.replace(CLOSE_TAG_RE, "");
  return value;
}

/** Extract closed <think>/<thinking> bodies and the cleaned answer. */
export function splitModelText(text: string): SplitModelText {
  const raw = String(text ?? "");
  const thinkingParts: string[] = [];
  let cursor = 0;
  const re = new RegExp(THINK_BLOCK_RE.source, "gi");
  let match: RegExpExecArray | null;
  let withoutClosed = "";
  while ((match = re.exec(raw)) !== null) {
    withoutClosed += raw.slice(cursor, match.index);
    const body = (match[2] ?? "").trim();
    if (body) thinkingParts.push(body);
    cursor = match.index + match[0].length;
  }
  withoutClosed += raw.slice(cursor);

  // Incomplete open think tag: treat remainder as thinking (don't show in result).
  const open = /<(think|thinking)(?:\s[^>]*)?>/i.exec(withoutClosed);
  if (open && open.index !== undefined) {
    const before = withoutClosed.slice(0, open.index);
    const after = withoutClosed.slice(open.index + open[0].length).replace(/<\/(?:think|thinking)>/gi, "");
    if (after.trim()) thinkingParts.push(after.trim());
    withoutClosed = before;
  }

  const result = stripInternalMarkup(withoutClosed)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const thinking = thinkingParts.join("\n\n").trim();
  return { result, thinking };
}

/** Final user-facing text (no protocol tags). */
export function cleanFinalText(text: string): string {
  return splitModelText(text).result;
}
