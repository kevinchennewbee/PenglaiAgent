# Penglai 0.6.2 on UnionTech UOS 20 LoongArch

Penglai publishes one `loongarch64` `.deb` for UnionTech UOS 20 Professional
1070 old-world systems. It is a complete application package, not a bootstrap
that asks the user to install Node, Electron, DSH, plugins, or model tooling.

The package contains the Loongson Electron runtime, vendor Node, official DSH
rc.2, all first-party plugins, Office, Memory, Mnemon, native add-ons,
licenses, and integrity manifests. The pre-publication verifier reopens the
final `.deb` and checks every declared byte, package identity, LoongArch ELF,
glibc 2.28 ceiling, runtime closure, and absence of foreign binaries.

System packages remain ordinary operating-system dependencies:

- `libatomic1` is required because the vendor Node binary links
  `libatomic.so.1`.
- `bubblewrap` is recommended for sandboxing. Penglai does not use
  `--no-sandbox` to make the app start.

The user flow is intended to match Mac and Windows: install one package, open
Penglai, complete the same seven-step guide, and use the same official DSH
Workspace, Office, Memory, and optional plugins. That intended parity is not a
native result yet. Physical UOS install, startup, UI rendering, file picker,
sleep/resume, real-model conversation, Office, and Memory remain
`OWNER_POST_RELEASE`. The Owner will test the immutable published package.

MOSS-TTS is unavailable on LoongArch. iMessage is Mac-only. UOS uses Loongson
Electron `31.7.7` / Chromium 126, which is no longer maintained and does not
provide the same security baseline as Electron `43.6.0` / Chromium 150 on Mac
and Windows.
