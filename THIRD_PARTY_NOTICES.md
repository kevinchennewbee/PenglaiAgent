# Third-Party Notices

This file records non-code assets or high-permission helper components that ship with PenglaiAgent.

## 0.4 Agent Kernel (MIT)

The 0.4 product line (`packages/`) runs its agent loop on the pinned **Pi** kernel:

| Dependency | Version | Source | License | Copyright |
| --- | --- | --- | --- | --- |
| `@earendil-works/pi-agent-core` | 0.83.0 (pinned) | https://github.com/earendil-works/pi | MIT | Copyright (c) Mario Zechner |
| `@earendil-works/pi-ai` | 0.83.0 (pinned) | https://github.com/earendil-works/pi | MIT | Copyright (c) Mario Zechner |

Penglai does not copy or fork Pi's agent loop; upstream differences are confined to
the `AgentKernel` adapter layer in `packages/host/src/kernel/`. The exact version is
pinned in `packages/host/package.json` and `package-lock.json`.

## 0.4 npm Runtime Dependencies

0.4 runtime dependencies are installed via npm and are not redistributed in this
repository (the desktop app's self-contained host runtime bundles them at packaging
time; that bundle is a build artifact, not tracked source). All are MIT / Apache-2.0 /
BSD-family licensed; the authoritative per-package license data is in
`package-lock.json`, enforced by `scripts/release-check.mjs`.

Voice I/O uses the npm builds of `sherpa-onnx` (Apache-2.0, k2-fsa contributors),
`onnxruntime-node` (MIT, Microsoft), and `sentencepiece-js` (Apache-2.0). Native
engines remain lazily loaded; the host starts normally when voice is unavailable.

## MOSS-TTS-Nano Node Runtime (Apache-2.0)

`packages/host/src/voice/third_party/moss_tts/runtime.mjs` is derived from the
OpenMOSS browser ONNX runtime and modified for Penglai's Node Host: native CPU ORT
sessions, filesystem-backed external weights, and a Node SentencePiece adapter
replace the browser WASM/iframe path. The modified file carries a prominent notice;
the upstream Apache-2.0 license is shipped adjacent as `LICENSE` and is copied into
the self-contained Desktop runtime.

Copyright 2026 OpenMOSS Team, Fudan University, SII and MOSI.

Except for the explicitly identified MOSS-TTS Node adaptation above, no source
modifications were made to the listed npm voice engines. Their licenses are
available in the installed packages and upstream repositories.
