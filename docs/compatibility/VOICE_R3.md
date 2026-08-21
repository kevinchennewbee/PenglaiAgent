# Voice codec pins (R3)

Penglai IM voice uses pinned WASM codecs, not system ffmpeg or Python.

| package | pin | notes |
| --- | --- | --- |
| `silk-wasm@3.7.1` | `3.7.1` | Weixin SILK |
| `libopus-wasm@0.2.0` | `0.2.0` | commit `55fe0b6faf9043518b7e1a7ea32e74659ecfbae7` |

These pins are enforced by `packages/audio-codecs/package.json` and `pnpm verify:contracts`.
