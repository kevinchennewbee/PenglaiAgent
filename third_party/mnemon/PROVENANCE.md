# Mnemon 0.2.8 provenance

Penglai Memory embeds one platform-specific binary from
[`mnemon-dev/mnemon`](https://github.com/mnemon-dev/mnemon) release `v0.2.8`,
source commit `da9b7da0e3e7f10c84d5f8e9a42e24453c8159bb`.

Mnemon is licensed under Apache-2.0, not MIT. The upstream `LICENSE` at that
commit has SHA-256
`c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`.
The same canonical Apache-2.0 text is already tracked at
`packages/moss-tts/third_party/sentencepiece-js-Apache-2.0.txt`; packaging
copies those exact bytes next to the Mnemon binary as `LICENSE`.

Archive and extracted-binary hashes for darwin-arm64, darwin-x64, Windows
x64, and the architecture-built linux-loong64 engine are frozen in
`packages/release-identity/src/mnemon-assets.js`. Official GitHub archives
are downloaded with a host allowlist, size bound, archive-path check, and
hash verify. They are never selected through a moving `latest` URL. The
UOS 20 linux-loong64 binary is built from the same tagged source (see
`docs/0.6.0/MNEMON_LOONG64.md`) and copied from
`native/linux-loong64-oldworld/artifacts/`.
