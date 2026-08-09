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

## Desktop Pet Skins

The desktop pet skin system is optional. Included skins are tracked with source and license metadata in each `frontends/skins/*/skin.json`.

| Skin | Source | License | Notes |
| --- | --- | --- | --- |
| `doux`, `mort`, `tard`, `vita` | https://arks.itch.io/dino-characters | CC0-1.0 | License metadata is stored in each skin file. |
| `dinosaur` | https://voidcordtech.itch.io/dino-spritesheet-animation | CC0-1.0 | Source page lists Creative Commons Zero v1.0 Universal. |
| `boy` | https://pzuh.itch.io/temple-run-game-sprites | CC0-1.0 | GameArt2D Free Assets License states Freebies assets are CC0/Public Domain. |
| `line` | Local asset pack metadata | CC0-1.0 | See `frontends/skins/line/License.txt`. |

The previous `glube` skin was removed from the public tree because its source page did not provide a standard SPDX-style license grant suitable for redistribution in this repository.

## TMWD CDP Bridge

`assets/tmwd_cdp_bridge/` is a developer/browser-automation helper extension distributed under the repository MIT license. It is not part of the default Penglai runtime.

The extension requests broad Chrome permissions such as `debugger`, `cookies`, and `<all_urls>` so it can automate user-approved browser sessions. Install it only in a browser profile intended for development or automation, and remove it when not needed.

## Runtime Dependencies (Apache-2.0)

PenglaiAgent is MIT-licensed. The following runtime dependencies are Apache-2.0 licensed (compatible with MIT). They are installed via pip/conda as user-facing dependencies — PenglaiAgent does not redistribute their source code or binaries in this repository. Attribution is provided here for transparency and compliance with Apache-2.0 §4(c).

| Dependency | Version | Source | License | Copyright |
| --- | --- | --- | --- | --- |
| sherpa-onnx | (pip) | https://github.com/k2-fsa/sherpa-onnx | Apache-2.0 | Copyright (c) k2-fsa contributors |
| MOSS-TTS-Nano | (pip) | https://github.com/OpenMOSS/MOSS-TTS-Nano | Apache-2.0 | Copyright (c) OpenMOSS contributors |

Except for the explicitly identified MOSS-TTS Node adaptation above, no source
modifications were made to these projects. Their licenses are available at the
upstream repositories linked above.
