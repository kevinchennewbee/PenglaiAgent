import assert from "node:assert/strict";
import test from "node:test";
import { assertVerifiedDraft, publicationAssetSeal } from "./publication-seal.mjs";

test("publication refuses any asset or source change after draft byte verification", () => {
  const sourceSha = "a".repeat(40);
  const rows = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, name: `asset-${index}`, size: 128, sha256: "b".repeat(64) }));
  const seal = publicationAssetSeal(rows);
  const contract = { publication: { tag: "v0.5.10" }, exactAssets: rows.map((row) => row.name) };
  const release = {
    tag_name: contract.publication.tag, target_commitish: sourceSha,
    draft: true, prerelease: false, immutable: false,
    assets: rows.map(({ sha256, ...row }) => ({ ...row, digest: `sha256:${sha256}` })),
  };
  assert.doesNotThrow(() => assertVerifiedDraft(release, contract, sourceSha, seal));
  assert.equal(publicationAssetSeal([...rows].reverse()), seal);
  for (const field of ["id", "size", "digest", "name"]) {
    const tampered = structuredClone(release);
    tampered.assets[0][field] = field === "id" || field === "size" ? 999 : "changed";
    assert.throws(() => assertVerifiedDraft(tampered, contract, sourceSha, seal));
  }
  assert.throws(() => assertVerifiedDraft({ ...release, assets: release.assets.slice(0, 3) }, contract, sourceSha, seal));
  assert.throws(() => assertVerifiedDraft({ ...release, target_commitish: "c".repeat(40) }, contract, sourceSha, seal));
  assert.throws(() => assertVerifiedDraft({ ...release, draft: false }, contract, sourceSha, seal));
  assert.throws(() => assertVerifiedDraft({ ...release, immutable: true }, contract, sourceSha, seal));
});
