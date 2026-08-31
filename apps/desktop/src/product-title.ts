export const PENGLAI_DESKTOP_TITLE = "蓬莱 Penglai";

export function normalizePenglaiDocumentTitle(title: string): string {
  return /DeepSeek Harness/i.test(title) ? PENGLAI_DESKTOP_TITLE : title;
}
