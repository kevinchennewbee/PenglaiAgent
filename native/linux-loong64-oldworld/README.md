# UOS 20 old-world native addons (architecture builds)

These are **architecture builds** of required DSH natives for UnionTech
desktop OS 20 / kernel 4.19 / glibc 2.28 (`linux-loong64`). They are not
repacked official npm loong64 optional packages.

Official `@koromix/koffi-linux-loong64@3.1.6` is new-world
(`GLIBC_2.36`, `ld-linux-loongarch-lp64d.so.1`) and must not be shipped.
Official sharp has no `linux-loong64` optional package; `sharp.cjs` loads
`src/build/Release/sharp-linux-loong64-0.35.4.node` first.

`node-addon-require-builtin` native is unpublished on loong64. Product web
uses `patchReload: startup`. Do not invent that native.

Native install/startup/function on UOS remains `OWNER_POST_RELEASE`.
Independent ABI review of libvips-cpp `2e9438ad…`:
`review/ABI-PROVENANCE-REVIEW-2e9438ad.md`.

JPEG in this libvips is **libjpeg-turbo 3.0.4**, not mozjpeg. Same libjpeg
API as official sharp-libvips 1.3.3.

Rebuild (not required for packaging): `buildscripts/` + `sourcepatch/` +
`SOURCES.json`. Packaging copies `artifacts/` by digest.
