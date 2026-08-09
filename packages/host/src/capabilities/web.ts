import { load } from "cheerio";
import { assertPublicHttpUrl, fetchPublicHttp } from "./network-safety.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 20_000;
const USER_AGENT = "PenglaiAgent/0.4 (+https://github.com/kevinchennewbee/PenglaiAgent)";

export interface WebFetchResult {
  url: string;
  status: number;
  contentType: string;
  title: string;
  text: string;
  truncated: boolean;
}

async function responseBytes(response: Response): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error(`response is too large (${declared} bytes; limit ${MAX_RESPONSE_BYTES})`);
  }
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        const keep = part.value.byteLength - (total - MAX_RESPONSE_BYTES);
        if (keep > 0) chunks.push(part.value.slice(0, keep));
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(chunks.reduce((sum, row) => sum + row.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

function htmlToText(html: string): { title: string; text: string } {
  const $ = load(html);
  $("script,style,noscript,svg,canvas,template").remove();
  const title = ($("title").first().text() || $("h1").first().text()).replace(/\s+/g, " ").trim();
  const root = $("main,article").first().length ? $("main,article").first() : $("body");
  const text = root
    .text()
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  return { title, text };
}

export async function fetchPublicPage(rawUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<WebFetchResult> {
  let url = await assertPublicHttpUrl(rawUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchPublicHttp(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.2" },
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`redirect ${response.status} has no Location header`);
      if (redirects === MAX_REDIRECTS) throw new Error("too many redirects");
      url = await assertPublicHttpUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const contentType = (response.headers.get("content-type") ?? "application/octet-stream").toLowerCase();
    if (!/(text\/|application\/(json|xml|xhtml\+xml))/.test(contentType)) {
      throw new Error(`unsupported web content type: ${contentType || "unknown"}`);
    }
    const { bytes, truncated } = await responseBytes(response);
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const parsed = contentType.includes("html") || contentType.includes("xhtml")
      ? htmlToText(decoded)
      : { title: "", text: decoded.trim() };
    return {
      url: url.href,
      status: response.status,
      contentType,
      title: parsed.title,
      text: parsed.text,
      truncated,
    };
  }
  throw new Error("unreachable redirect state");
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export function parsePublicSearchResults(raw: string, limit = 5): WebSearchResult[] {
  const boundedLimit = Math.max(1, Math.min(10, Math.floor(limit)));
  const doc = load(raw);
  const rows: WebSearchResult[] = [];
  doc(".result").each((_index, element) => {
    if (rows.length >= boundedLimit) return false;
    const anchor = doc(element).find(".result__a").first();
    const href = anchor.attr("href") ?? "";
    const title = anchor.text().replace(/\s+/g, " ").trim();
    if (!href || !title) return;
    let resolved = href;
    try {
      const redirect = new URL(href, "https://html.duckduckgo.com/");
      resolved = redirect.searchParams.get("uddg") ?? redirect.href;
      const parsed = new URL(resolved);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    } catch {
      return;
    }
    const snippet = doc(element).find(".result__snippet").text().replace(/\s+/g, " ").trim();
    rows.push({ title, url: resolved, snippet });
  });
  return rows;
}

export async function searchPublicWeb(query: string, limit = 5): Promise<WebSearchResult[]> {
  const q = query.trim();
  if (!q) throw new Error("search query is empty");
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const raw = await fetchSearchMarkup(searchUrl);
  return parsePublicSearchResults(raw, limit);
}

async function fetchSearchMarkup(rawUrl: string): Promise<string> {
  const url = await assertPublicHttpUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchPublicHttp(url, {
      redirect: "error",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
    });
    if (!response.ok) throw new Error(`search HTTP ${response.status}`);
    const { bytes } = await responseBytes(response);
    return new TextDecoder().decode(bytes);
  } finally {
    clearTimeout(timer);
  }
}
