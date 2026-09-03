import { execFileSync } from "node:child_process";

// GitHub's REST tag endpoint resolves published releases. Drafts with pending
// tags must first be resolved to their stable numeric release ID.
export function githubReleaseEndpoint(repo, { draft, tag, releaseId }, run = execFileSync) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || typeof tag !== "string" || !tag) {
    throw new Error("invalid GitHub release repository or tag");
  }
  if (!draft) return `repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const id = String(releaseId ?? run("gh", ["release", "view", tag, "--repo", repo, "--json", "databaseId", "--jq", ".databaseId"], { encoding: "utf8" })).trim();
  if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new Error("a valid numeric draft release ID is required");
  }
  return `repos/${repo}/releases/${id}`;
}
