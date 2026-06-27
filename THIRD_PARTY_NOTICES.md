# Third-Party Notices

This file records non-code assets or high-permission helper components that ship with PenglaiAgent.

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

No modifications were made to these projects. Their LICENSE files are available at the upstream repositories linked above.
