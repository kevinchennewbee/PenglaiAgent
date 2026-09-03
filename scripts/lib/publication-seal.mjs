import { createHash } from "node:crypto";

export function publicationAssetSeal(rows) {
  const normalized = rows.map(({ id, name, size, sha256 }) => ({ id, name, size, sha256 })).sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(normalized.map((row) => row.name)).size !== normalized.length || normalized.some((row) => !Number.isSafeInteger(row.id) || row.id <= 0 || !Number.isSafeInteger(row.size) || row.size <= 0 || !/^[a-f0-9]{64}$/.test(row.sha256))) {
    throw new Error("invalid publication asset identity");
  }
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function assertVerifiedDraft(release, contract, sourceSha, verifiedSeal) {
  if (release.tag_name !== contract.publication.tag || release.target_commitish !== sourceSha || release.draft !== true || release.prerelease !== false || release.immutable === true) {
    throw new Error("draft release identity changed after verification");
  }
  const rows = release.assets.map((asset) => ({ id: asset.id, name: asset.name, size: asset.size, sha256: String(asset.digest ?? "").replace(/^sha256:/, "") }));
  if (publicationAssetSeal(rows) !== verifiedSeal || JSON.stringify(rows.map((row) => row.name).sort()) !== JSON.stringify([...contract.exactAssets].sort())) {
    throw new Error("draft assets changed after complete signed-byte verification");
  }
}
