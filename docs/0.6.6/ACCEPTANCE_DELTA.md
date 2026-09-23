# Penglai 0.6.6 acceptance delta — candidate

Status: development contract. No 0.6.6 source, native, installed, public release, or website result is claimed by this document.

## Scope

- Consume the exact official DSH `0.1.7-alpha.2` source and signed npm cohort, including the matching vendor and native packages. Keep a single DSH agent, Workspace, Session, Turn, settings and plugin-management core. The audited cohort is not automatically the shipped runtime closure.
- Upgrade the DSH home and Session V4 migration without changing original 0.6.5 user data until a verified transaction. Verify restart, recovery and downgrade refusal against a copied fixture and an installed candidate. Native installed upgrade from both immutable 0.6.3 and 0.6.5 is required on Mac and Windows for this candidate; the historical 0.6.3→0.6.5 exclusion does not count as 0.6.6 evidence.
- Adapt each non-Office first-party plugin: `@penglai/im` and its existing channel adapters, Memory, Context, ASR, MOSS-TTS, Plugin Center, Plugin Reference, Plugin Pilot, Budget and Companion. Include Budget and Companion in the workspace and package only after default-off, workspace isolation, authorization and lifecycle checks pass. Office, LibreOffice and PDF/OOXML processing stay absent.
- Keep IM inbound text as untrusted data, validate binding and session membership at every operation, and recover outbound delivery without duplicate sends. Compare applicable `@xmanrui/dsh-im` 4.18.1→4.25.0 fixes for Weixin file upload/diagnostics, Feishu correlation and reconnect, Telegram retry/Unicode, DingTalk quoted attachments, QQ corrupt state, and source-guidance injection. New channels and reasoning-stream exposure require separate product decisions and are not implied here.
- Verify DSH plugin installation, build-script consent, profile configuration migration, official UI mounting, Remote behavior, and all bundled plugins with the candidate DSH. Verify that optional ASR/TTS/Budget/Companion can be disabled without stopping IM or Memory.
- Preserve the existing exact three-target release model unless the release contract is explicitly changed. Source and cross-build checks cannot stand in for Apple Silicon or Windows installed tests; UOS package verification cannot stand in for UOS native tests. Two-hour soak remains excluded.
- Publish only after a clean single source SHA, release-contract asset set, native and applicable installed evidence, immutable public assets, byte readback, then public README/site updates. Until then v0.6.5 remains the latest public download.

## Required proof before release

| Area | Required observation |
| --- | --- |
| DSH cohort | Source tag/commit, official registry signatures and tarball bytes, exact lock graph, no mixed DSH generations |
| Session/data | V3→V4 fixture migration, byte-preserved originals, crash/restart, active user data isolation |
| Plugins | Each first-party plugin loads against installed DSH; enable/disable/restart; failure isolation; permissions and settings |
| IM | Workspace/session fences; retry/dedup; attachment admission; channel-specific source and installed tests; no unconsented reasoning disclosure |
| Safety | Secret scan, dependency/license/security gates, no Office/LibreOffice/PDF runtime, Budget and Companion default off with explicit action limits |
| Distribution | Source CI, three native packages from one clean SHA, Mac/Windows installed journeys, UOS package/ABI/closure, immutable public-byte readback |

Missing evidence is `NOT_RUN`, not PASS. Owner acceptance and public publication are separate from development checks.
