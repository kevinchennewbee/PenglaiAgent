# ADR 0037 — IM Registry and multi-bot

- Status: Accepted
- Date: 2026-08-24
- Version: Penglai 0.5.6 implementation
- Requirements: R56-IM-001 .. R56-IM-020, R56-CH-*

## Context

0.5.5 `@penglai/im` hard-codes Weixin and Feishu. Channel packages depend on ASR/TTS. The UI exposes engineering fields. Nine-platform coverage must not copy dsh-im's support list or install that runtime.

## Decision

1. Keep one `@penglai/im` Core. Channels register through `ChannelManifestV1` + `ChannelAdapterV1`. Adapters never call a model, never list arbitrary Workspace/Session/path, and never return raw SDK objects.
2. Reference only: `xmanrui/dsh-im` v2.0.1 commit `dea9a8f2d1a3fdbb12a7b2a227ce93d0004257d9`, MIT. Import reviewed adapter/UI ideas with file-level provenance. Do not start the dsh-im runtime.
3. Each bot has isolated credential ref, state, AbortController, and circuit breaker. Bindings are bot + Workspace, optional Session/Preset, versioned, and Owner-receipted.
4. Private chat defaults to allowlist; unknown actors are silent. Groups default off. Missing/unknown chat type, sender, route, or tenant Fail Closed.
5. Outbox hashes actual Artifact bytes. Caller digests are expectations only. Body retention defaults to 24h across DB, WAL, backup, and artifacts.
6. Connection UI is named Connect, not Scan for every platform. Slack, Telegram, and Discord use their official bot/OAuth/token flows. No fake QR codes.
7. A platform is "supported" only after live connect, inbound -> official DSH Turn -> outbound, restart, revoke, and fault evidence.

## Consequences

- ASR/TTS become optional contracts. Channel packages drop hard engine dependencies.
- Schema migrates from IM v11 with copy/validate/swap. Rollback to 0.5.5 must not delete new-platform rows or misread them as Weixin/Feishu.
- WhatsApp stays default-off with an explicit community-protocol risk acknowledgement.
