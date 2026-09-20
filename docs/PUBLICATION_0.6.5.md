# PUBLICATION 0.6.5

Status: `PUBLIC_READBACK_PASS`. The website deployment is recorded below.

## What was published

| Field | Value |
| --- | --- |
| Tag | `v0.6.5`, immutable, `target_commitish` = build SHA |
| Build source SHA | `eb90f494d6ccd8f3fe7f29ffc5007b8ada94be4a` |
| Release id | `392337556` |
| Published at | `2026-09-20T07:00:58Z` |
| Assets | ten, exactly the set in `release-contract.json` |
| Asset-set seal | `10a69d3bf24a73be3ccd0ea2bdf01db3e8c8ac907afa7d79898039409940d7a8` |

## Sequence

1. Source: PR #215 merged into `main`; the merge commit is the build SHA. Source
   CI [35490512465](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35490512465)
   and CodeQL [35490512032](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35490512032)
   passed on that exact commit.
2. Native: [35490538515](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35490538515)
   built `darwin-aarch64`, `win32-x86_64` and `linux-loong64` from that commit
   and the aggregate reported `verify:release` `PASS` — 22 gates, and
   `verify:evidence` `PASS` with 80 hard ids, 0 notRun, 0 duplicate.
3. Draft: `v0.6.5` was created as a mutable draft carrying only the three exact
   installers. Each installer byte was checked against the native evidence
   before upload.
4. Assembly: `pnpm assemble:release --source-sha eb90f494…` re-downloaded the
   draft assets, compared them byte-for-byte with the local staging copies, and
   wrote the remaining seven assets: `update-manifest-v1.json` and its Ed25519
   signature, `release-manifest.json`, `SBOM.cdx.json`,
   `THIRD_PARTY_NOTICES.txt`, `SHA256SUMS`, `public-export-manifest.json`.
5. Publish: [35495632957](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35495632957)
   verified the complete signed draft, published it once, and read the immutable
   public bytes back. The draft seal and the public seal are identical, which is
   what proves the published bytes are the verified bytes.

## Website deployment

[35496762583](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35496762583)
verified the immutable public release, re-ran the publication-window check over
the tag commit and the commit that recorded this manifest, sealed the `website/`
tree, deployed those exact bytes to `gh-pages`, and read both public origins
back. `https://penglai.pages.dev/` and
`https://kevinchennewbee.github.io/PenglaiAgent/` served the same 0.6.5 page,
each carrying the build source SHA and the three published installer digests.

## Not claimed

`0.6.3 → 0.6.5` installed-upgrade journey and the two-hour installed soak are
`OWNER_EXCLUDED`. UOS native install, startup, UI, file picker, sleep/resume and
function are `OWNER_POST_RELEASE`. macOS notarization and Windows Authenticode
are `NOT_RUN` for this release.
