# Penglai 0.5.8 publication and public-narrative flow

This file prevents a repeated release-order error: a README, website, local
installer, green source job, or rebuilt artifact must never get ahead of the
immutable public bytes it describes.

## Authoritative order

1. Complete code and package work on `0.5.8-preview`.
2. Pass source, package, clean-clone, and required functional gates.
3. Open and review the product PR; do not change current 0.5.7 public claims.
4. Merge the product PR through required checks.
5. Freeze the exact final `main` SHA and generate the clean public export.
6. Build Apple Silicon, Intel Mac, and Windows x64 artifacts from that same SHA.
7. Run target-native installed acceptance and permitted Owner-live acceptance.
8. Assemble the exact 0.5.8 asset set and inspect its manifests, signatures,
   sizes, hashes, provenance, SBOM, notices, and public-export binding.
9. Publish immutable `v0.5.8` assets.
10. Download every public asset again and pass release readback.
11. Only now update root README, bilingual release notes, publication manifest,
    `website/`, and the website deployment workflow with observed values.
12. Merge the public-narrative change, deploy `website/` to `gh-pages`, then
    verify Chinese, English, and all download links from the public Internet.
13. Update repository metadata only after the live site is correct.

## What remains protected before step 10

- `README.md` continues to describe the immutable current 0.5.7 Release.
- `website/` and live `gh-pages` continue to describe 0.5.7.
- `.github/workflows/deploy-website.yml` continues to require 0.5.7 readback.
- `release-contract.json` continues to describe 0.5.7 until the candidate
  identity and exact 0.5.8 asset contract are ready for the release PR.
- `v0.5.7`, its ten assets, release body, hashes, and update metadata are never
  modified.

Preview documentation may describe planned 0.5.8 behavior only inside
`docs/0.5.8/`. It must visibly label source/package/native/installed/live/public
evidence and must not expose predicted public hashes or invented PASS results.

## Public readback requirements

- Release is published, immutable in process, and not a draft or prerelease.
- Tag resolves to the final source SHA.
- Asset names equal the release contract exactly; no extra or missing files.
- Every downloaded byte matches SHA256SUMS and release-manifest metadata.
- Signed updater metadata verifies and covers exactly three target installers.
- Installer release-info reports the same product, DSH source provenance,
  toolchain, target, source SHA, and public-export tree.
- README and website use the downloaded public sizes/hashes, not local values.

## Website readback requirements

- `https://penglai.pages.dev/` is the complete Chinese page.
- `https://penglai.pages.dev/en/` is the complete English page.
- Both pages name Penglai as a DSH desktop distribution and do not imply a
  second agent core.
- Every platform download resolves to the exact `v0.5.8` Release asset.
- Known signing/notarization/platform/account limitations remain honest.
- No stale current-product 0.5.7, rc.2, WhatsApp, old Host, Pi-core, or Tauri
  claim survives outside clearly historical context.
- Browser-visible screenshots are release-correct and privacy-safe.
