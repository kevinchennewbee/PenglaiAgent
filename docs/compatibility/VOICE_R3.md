# Voice codec pins (R3)

Penglai IM voice uses pinned WASM codecs, not system ffmpeg or Python.

| package | pin | notes |
| --- | --- | --- |
| `silk-wasm@3.7.1` | `3.7.1` | Weixin SILK |
| `libopus-wasm@0.3.0` | `0.3.0` | commit `bd37b907c636705d59cc2b836e6912e317a65a47` |

These pins are enforced by `packages/audio-codecs/package.json` and `pnpm verify:contracts`.
