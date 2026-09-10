# Penglai 0.6.1 known limits

Not a public download claim. These are current 0.6.1 source/acceptance
limits. They do not rewrite published 0.5.x or 0.6.0 records.

## UOS native host

UnionTech UOS 20 LoongArch remains the fourth packaged target. Artifact
integrity, architecture/old-world ABI, target Node/runtime identity,
dependencies, sandbox/lifecycle preparation, and closure still require
verification. Native install, startup, and function on a physical UOS host
are `OWNER_POST_RELEASE`: the Owner will test the published installer.
That is not a native PASS and not an unavailable-host waiver that skips
the fourth artifact.

Old-version installed upgrade acceptance is excluded. Fresh install,
normal restart, and uninstall remain. No two-hour soak.

## Office preview

The official generic right sidebar offers only a plain-text preview for
DOCX and reports a non-text file. Structured Office inspect/preview and
the saved Office bytes remain the product path. This is not a universal
OOXML visual renderer.

## Windows supervisor identity

Windows snapshot `dshPid` versus supervisor identity is a later native
check, not an established source defect in this follow-up.
