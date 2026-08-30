# DeepSeek Harness fixed-source package closure

This directory carries the package inputs built from the Owner-fixed official
DeepSeek Harness source tag for Penglai 0.5.8. It is not a fork and it is not a
publication of the `@deepseek-ai` npm scope.

The version directory is generated only by this repository's reviewed flow:

1. `pnpm prepare:dsh-source-closure`
2. `pnpm promote:dsh-source-closure`
3. `pnpm verify:dsh-vendored-closure`

`docs/0.5.8/DSH_SOURCE_CLOSURE.json` pins the upstream repository, tag, commit,
tree, source archive digest, toolchain, official client build profile, package
counts, and destination. The promoted `closure-manifest.json` binds every
tarball to its identity, version, size, SHA-256, license, official client build
record, and successful clean packed-install readback.

The upstream release packer can emit semantically identical `package.json`
objects in a different key order when its parallel build order changes. The
reviewed flow therefore recursively sorts only the generated package manifest,
repacks the unchanged payload with the pinned `npm@10.9.7` and lifecycle scripts
disabled, then compares every path, byte, mode, and symlink before accepting the
archive. Two consecutive full builds must be byte-identical. This is packaging
normalization, not an upstream source patch.

All 0.5.8 product manifests, the lockfile, runtime closure, Profile, and release
identity must switch together. A partial local closure or registry fallback is
forbidden.
