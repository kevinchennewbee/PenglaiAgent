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
