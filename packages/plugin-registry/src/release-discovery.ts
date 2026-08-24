import { BOUNDED_HTTP_MAX_BYTES, PenglaiError, readBoundedResponse } from "@penglai/contracts";
import { APP_REPO, GITHUB_API_ORIGIN, GITHUB_OWNER, PLUGIN_REGISTRY_REPO } from "./catalog-schema.js";

export const CATALOG_TAG = /^plugin-catalog-v1\.(\d{6})$/;
export const APP_TAG = /^v\d+\.\d+\.\d+$/;

export interface DiscoveredRelease {
  tag: string;
  sequence?: number;
  immutable: true;
  assets: Array<{ id: number; name: string; url: string; digest?: string; size: number }>;
}

export interface GitHubReleaseLike {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  immutable?: unknown;
  assets?: Array<{
    id?: unknown;
    name?: unknown;
    browser_download_url?: unknown;
    digest?: unknown;
    size?: unknown;
  }>;
}

export function assertGithubApiUrl(url: string, owner: string, repo: string): URL {
  const parsed = new URL(url);
  if (parsed.origin !== GITHUB_API_ORIGIN || parsed.username || parsed.password || parsed.search.includes("latest")) {
    throw new PenglaiError("SECURITY_POLICY", "discovery must use the fixed GitHub API origin");
  }
  const expected = `/repos/${owner}/${repo}/releases`;
  if (parsed.pathname !== expected && !parsed.pathname.startsWith(`${expected}?`)) {
    if (parsed.pathname !== expected) throw new PenglaiError("SECURITY_POLICY", "discovery path is not the fixed repository");
  }
  return parsed;
}

export function selectHighestCatalogRelease(raw: readonly GitHubReleaseLike[]): DiscoveredRelease {
  const accepted: DiscoveredRelease[] = [];
  for (const item of raw) {
    if (item.draft === true || item.prerelease === true || item.immutable !== true) continue;
    const tag = typeof item.tag_name === "string" ? item.tag_name : "";
    const match = CATALOG_TAG.exec(tag);
    if (!match) continue;
    accepted.push({
      tag,
      sequence: Number(match[1]),
      immutable: true,
      assets: mapAssets(item.assets ?? []),
    });
  }
  accepted.sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0));
  const top = accepted[0];
  if (!top) throw new PenglaiError("INVALID_INPUT", "no immutable plugin-catalog release");
  return top;
}

export function selectHighestAppRelease(
  raw: readonly GitHubReleaseLike[],
  currentVersion: string,
  channel = "stable",
): DiscoveredRelease | undefined {
  void channel;
  const accepted: Array<DiscoveredRelease & { version: string }> = [];
  for (const item of raw) {
    if (item.draft === true || item.prerelease === true || item.immutable !== true) continue;
    const tag = typeof item.tag_name === "string" ? item.tag_name : "";
    if (!APP_TAG.test(tag)) continue;
    const version = tag.slice(1);
    if (compareDot(version, currentVersion) <= 0) continue;
    accepted.push({
      tag,
      immutable: true,
      version,
      assets: mapAssets(item.assets ?? []),
    });
  }
  accepted.sort((a, b) => compareDot(b.version, a.version));
  return accepted[0];
}

function mapAssets(
  assets: NonNullable<GitHubReleaseLike["assets"]>,
): DiscoveredRelease["assets"] {
  return assets.map((asset) => ({
    id: Number(asset.id),
    name: String(asset.name ?? ""),
    url: String(asset.browser_download_url ?? ""),
    size: Number(asset.size ?? 0),
    ...(typeof asset.digest === "string" ? { digest: asset.digest } : {}),
  }));
}

function compareDot(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

export function catalogListUrl(): string {
  return `${GITHUB_API_ORIGIN}/repos/${GITHUB_OWNER}/${PLUGIN_REGISTRY_REPO}/releases`;
}

export function appListUrl(): string {
  return `${GITHUB_API_ORIGIN}/repos/${GITHUB_OWNER}/${APP_REPO}/releases`;
}

export function taggedReleaseAssetUrl(
  owner: string,
  repo: string,
  tag: string,
  asset: string,
): string {
  for (const [value, label] of [
    [owner, "owner"],
    [repo, "repo"],
    [tag, "tag"],
    [asset, "asset"],
  ] as const) {
    if (!value || value.includes("/") || value.includes("\\") || value.includes("..")) {
      throw new PenglaiError("SECURITY_POLICY", `invalid GitHub release ${label}`);
    }
  }
  return `https://github.com/${owner}/${repo}/releases/download/${tag}/${asset}`;
}

/**
 * GitHub's anonymous REST quota is shared by an IP and can return 403 even for
 * public repositories. The Atom feed is only a discovery hint: callers must
 * still download a tag-specific manifest and verify its embedded signature,
 * monotonic sequence, exact tag, hashes, and target before trusting anything.
 */
export async function fetchGithubReleaseTags(input: {
  owner: string;
  repo: string;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<string[]> {
  if (!/^[A-Za-z0-9_.-]+$/.test(input.owner) || !/^[A-Za-z0-9_.-]+$/.test(input.repo)) {
    throw new PenglaiError("SECURITY_POLICY", "invalid GitHub Atom repository");
  }
  const url = `https://github.com/${input.owner}/${input.repo}/releases.atom`;
  const response = await input.fetchImpl(url, {
    redirect: "manual",
    headers: { accept: "application/atom+xml", "user-agent": "penglai-release-discovery" },
    signal: AbortSignal.timeout(input.timeoutMs ?? 15_000),
  });
  if (response.status !== 200 || response.redirected) {
    throw new PenglaiError("DELIVERY_TRANSIENT", `GitHub releases feed refused: ${response.status}`);
  }
  const maxBytes = input.maxBytes ?? BOUNDED_HTTP_MAX_BYTES.registryMetadata;
  const text = (
    await readBoundedResponse({
      response,
      maxBytes,
      category: "registry-metadata",
      timeoutMs: input.timeoutMs ?? 15_000,
    })
  ).bytes.toString("utf8");
  const prefix = `href="https://github.com/${input.owner}/${input.repo}/releases/tag/`;
  const tags: string[] = [];
  let offset = 0;
  while (tags.length < 100) {
    const start = text.indexOf(prefix, offset);
    if (start < 0) break;
    const valueStart = start + prefix.length;
    const end = text.indexOf('"', valueStart);
    if (end < 0) throw new PenglaiError("INVALID_INPUT", "GitHub releases feed link is truncated");
    const encoded = text.slice(valueStart, end);
    let tag: string;
    try {
      tag = decodeURIComponent(encoded);
    } catch {
      throw new PenglaiError("INVALID_INPUT", "GitHub releases feed tag encoding");
    }
    if (tag && !tag.includes("/") && !tag.includes("\\") && !tags.includes(tag)) tags.push(tag);
    offset = end + 1;
  }
  if (!tags.length) throw new PenglaiError("DELIVERY_TRANSIENT", "GitHub releases feed has no tags");
  return tags;
}

function nextLink(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="next"/i.exec(part);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

export async function fetchGithubReleasePages(input: {
  url: string;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
  maxPages?: number;
  maxBytes?: number;
  etag?: string;
}): Promise<{ releases: GitHubReleaseLike[]; etag?: string; notModified?: boolean }> {
  const maxPages = input.maxPages ?? 5;
  const timeoutMs = input.timeoutMs ?? 15_000;
  const maxBytes = input.maxBytes ?? BOUNDED_HTTP_MAX_BYTES.registryMetadata;
  const releases: GitHubReleaseLike[] = [];
  let url = input.url.includes("?") ? input.url : `${input.url}?per_page=100`;
  let etag = input.etag;
  for (let page = 0; page < maxPages; page += 1) {
    const parsed = new URL(url);
    const pathMatch = /^\/repos\/([^/]+)\/([^/]+)\/releases$/.exec(parsed.pathname);
    if (!pathMatch || parsed.origin !== GITHUB_API_ORIGIN) {
      throw new PenglaiError("SECURITY_POLICY", "discovery must use the fixed GitHub API origin");
    }
    const owner = pathMatch[1];
    const repo = pathMatch[2];
    if (!owner || !repo) throw new PenglaiError("SECURITY_POLICY", "discovery must use the fixed GitHub API origin");
    assertGithubApiUrl(`${parsed.origin}${parsed.pathname}`, owner, repo);
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "penglai-plugin-registry",
    };
    if (page === 0 && etag) headers["if-none-match"] = etag;
    const response = await input.fetchImpl(url, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 304) return { releases: [], ...(etag ? { etag } : {}), notModified: true };
    if (response.status !== 200) {
      throw new PenglaiError("DELIVERY_TRANSIENT", `GitHub releases list refused: ${response.status}`);
    }
    if (page === 0) {
      const nextEtag = response.headers.get("etag");
      if (nextEtag) etag = nextEtag;
    }
    const text = (
      await readBoundedResponse({
        response,
        maxBytes,
        category: "registry-metadata",
        timeoutMs,
      })
    ).bytes.toString("utf8");
    const raw = JSON.parse(text) as unknown;
    if (!Array.isArray(raw)) throw new PenglaiError("INVALID_INPUT", "GitHub releases list");
    releases.push(...(raw as GitHubReleaseLike[]));
    const next = nextLink(response.headers.get("link"));
    if (!next) break;
    const nextUrl = new URL(next);
    if (nextUrl.origin !== GITHUB_API_ORIGIN) {
      throw new PenglaiError("SECURITY_POLICY", "GitHub pagination left the API origin");
    }
    url = nextUrl.href;
  }
  return { releases, ...(etag ? { etag } : {}) };
}
