/**
 * Pure display formatters for the desktop workbench (zh-CN, no DOM).
 */

/** Relative time label: 刚刚 / N 分钟前 / N 小时前 / M月D日. */
export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))} 小时前`;
  // Built manually: Intl month/day style varies across ICU builds.
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** HH:MM clock label for stream timestamps. */
export function clockLabel(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

/** Compact token counter: 812 / 3.2k / 1.4万. */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "0";
  if (count < 1000) return String(Math.floor(count));
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 10_000).toFixed(1)} 万`;
}

/** Budget ratio → integer percent label; null when unbounded. */
export function formatRatio(ratio: number | null): string {
  if (ratio === null) return "无上限";
  return `${Math.round(ratio * 100)}%`;
}

/** Short id for dense lists (task/run/conversation ids). */
export function shortId(id: string, length = 8): string {
  return id.length <= length ? id : id.slice(0, length);
}

/** Truncate a long single line for titles. */
export function oneLine(text: string, max = 72): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** First line of a multiline text (task titles from objectives). */
export function firstLine(text: string, max = 72): string {
  return oneLine(text.split(/\r?\n/, 1)[0] ?? "", max);
}

/** Semantic version compare for handshake compatibility (a<b → -1). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    const diff = (pa[index] ?? 0) - (pb[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}
