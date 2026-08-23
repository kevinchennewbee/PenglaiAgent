# Mnemon 0.2.4 provenance

Penglai Memory embeds one platform-specific binary from
[`mnemon-dev/mnemon`](https://github.com/mnemon-dev/mnemon) release `v0.2.4`,
source commit `67ed1a2f80de902fd041eeaf3b90e7e3d2480d5b`.

Mnemon is licensed under Apache-2.0, not MIT. The upstream `LICENSE` at that
commit has SHA-256
`c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`.
The same canonical Apache-2.0 text is already tracked at
`packages/moss-tts/third_party/sentencepiece-js-Apache-2.0.txt`; packaging
copies those exact bytes next to the Mnemon binary as `LICENSE`.

Archive and extracted-binary hashes for all three targets are frozen in
`packages/release-identity/src/mnemon-assets.js`. Downloads are explicit,
host-allowlisted, size-bounded, archive-path checked, hash-verified, and are
never selected through a moving `latest` URL.
