# ADR 0027 — IM audio codec WASM closure

Status: Accepted

## Context

Penglai 0.5 must decode Tencent iLink encrypted SILK locally and must decode/upload Feishu Opus locally on macOS arm64/x64 and Windows x64. Production cannot depend on a system codec, PATH, package manager, postinstall, or first-run binary download. The adapters may call only typed ASR/TTS services and must not load either speech model themselves.

## Decision

- Pin `silk-wasm@3.7.1` (MIT) for iLink `encode_type=6` decode. Package its `lib/silk.wasm` inside `@penglai/im` and verify the WASM magic and exact license/runtime hashes while packing.
- Pin `libopus-wasm@0.2.0` at `55fe0b6faf9043518b7e1a7ea32e74659ecfbae7` (MIT, libopus 1.6.1 notices) for raw Opus encode/decode. Its generated module contains the WASM payload, has no install script, and is packaged inside `@penglai/im`. The upstream module contains absolute compiler paths only in debug strings; packaging verifies the upstream hash, replaces that prefix with a same-length neutral prefix, verifies the transformed hash, and instantiates/encodes with the transformed runtime.
- Use Penglai's bounded Ogg Opus mux/demux around raw packets: mono 16 kHz, fixed frame duration, CRC validation, exact granule accounting, and strict magic/channel/rate/page/packet/byte/duration limits.
- Normalize decoded audio to PCM16 WAV before passing an opaque handle to `penglaiAsr`; feed only exact durable assistant finals to `penglaiMossTts` before channel delivery.
- Keep Weixin outbound audio as encrypted visible FILE plus deterministic text fallback. A native voice bubble remains capability-probe-only. Feishu outbound uses official `file.create(file_type=opus)` followed by `msg_type=audio`.

## Rejected alternatives

- System `ffmpeg`, Homebrew, PATH, Python, or PowerShell: not self-contained or three-platform deterministic.
- Native addon codec packages: unnecessary ABI/platform expansion for this bounded workload.
- Unpinned CDN converters or first-run installers: violate offline closure and supply-chain contracts.
- Treating an ordinary Feishu file attachment as audio, or treating iLink `ret=0` as proof of a visible native bubble.

## Consequences

The IM plugin tarball carries both codec packages and their licenses/notices. Dependency, license, plugin-closure, artifact, installed, and live verifiers must invalidate the candidate if versions, integrity, runtime bytes, or codec behavior drift. Real tests cover SILK and Ogg Opus round-trips, malformed/checksum rejection, iLink AES/CDN handling, Feishu resource/upload APIs, exact routing, cancellation, and duplicate-delivery prevention.
