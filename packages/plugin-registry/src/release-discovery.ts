import { PenglaiError } from "@penglai/contracts";
import { APP_REPO, GITHUB_OWNER, PLUGIN_REGISTRY_REPO } from "./catalog-schema.js";

export const CATALOG_TAG = /^plugin-catalog-v1\.(\d{6})$/;
export const APP_TAG = /^v\d+\.\d+\.\d+$/;
export const GITHUB_API_ORIGIN = "https://api.github.com";

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
