# Penglai 0.6.6 source review and adaptation record

Status: candidate review, observed in an isolated worktree on 2026-09-22/23. This record does not claim installed, native, live-account or public-release acceptance.

## Exact inputs

- Product source base: `ce8eb049523e786e65f5bfdb20f64d9e6ab4c7e8` from public `kevinchennewbee/PenglaiAgent`. The owner checkout was not edited.
- Official DSH: tag `dsh-v0.1.7-alpha.2`, commit `00102833dfaee1da9f48a3a8eae9d34005a75218`, source archive SHA-256 `8d6cd89a37da6f292f60c757c2f88a3fac6de904b2fc3ab883b0c0adf7edc7a2`, official CLI npm tarball SHA-256 `e19ae853b95f092448bac2ac3d0c077e59b7db209266dbc266b1c610ca2b6afb`. The signed registry cohort has 309 DSH, 9 vendor and 5 native packages. `DSH_NPM_COHORT.json` is the audit input; the packaged runtime closure is determined separately.
- Community IM comparison: `@xmanrui/dsh-im` tag `v4.25.0`, commit `00e02055bf70ffd83691e395c6ac2a11aad1f5fd`. Its own `package.json` declares compatible DSH releases only through `0.1.5-alpha.1`; the package is not substituted for Penglai IM on 0.1.7.

## DSH migration decisions

| Changed upstream seam | Penglai response | Evidence boundary |
| --- | --- | --- |
| Session V4 and V3-to-V4 repair/catalog rules | New 0.1.7 DSH home generation; copy old bytes before validation, activate after healthy proof, retain exact prior pointer for rollback. | A fixture mounted by official 0.1.7 JSONL persistence generated a V4 successor in the copied home while the 0.6.5 V3 source stayed byte-identical. Installed upgrade is still required. |
| Typert remote schema contract | Budget, Companion, IM and Center codecs use the 0.1.7 `create()` parser contract. | All eight non-Office plugin archives packed, source contract tests passed, and the real profile matrix loaded every selected combination. |
| Browser login exchange responds with relative `Location: ./` | Exact loopback token exchange accepts that official redirect and keeps cookie probing private. | Focused auth tests and real embedded 0.1.7 startup passed. |
| Preset composition and inventory startup ordering | Center waits for loader readiness before inventory snapshot; it does not block plugin apply on inventory composition. | Real embedded startup initially blocked, then passed in fresh, IM-only, voice, Budget, Companion and full modes; no process was left running. |
| App boot identity during official settings writes | Keep `dsh-app-boot` in the verified application runtime, but omit its redundant private-profile copy so DSH resolves one process-local root Include registry. | The first 0.6.6 DMG booted but its welcome confirmation failed; a direct official `settings/mutate` returned `profile reload requires the root Include entry`. Diagnostic module URLs proved that startup used the application copy and the settings editor used the profile copy. The source fix and unit check pass; the corrected installed DMG must still pass. |
| Official plugin manager registry fallback and build-script consent | Keep the exact official manager as package engine, application-owned Node/pnpm, and separate third-party install and build-script approval. | Source contracts and mounted Center pass. Third-party installation on a packaged candidate remains an installed gate. |

## First-party plugin boundary

Office, LibreOffice and Office/PDF processing remain absent. Memory and IM are bundled and enabled on a fresh profile. ASR, MOSS-TTS, Budget and Companion are bundled but disabled by default. Budget/Companion action handlers and read-only session snapshots were restored with owner authorization boundaries; their legacy Typert codec was updated. Context, Plugin Reference and Plugin Pilot remain bounded first-party components rather than a second agent runtime. The official DSH core retains ownership of Agent, Workspace, Session, Turn, tools, approvals, Web and plugin package management.

## Community IM change review

| v4.18.1 → v4.25.0 change | Penglai decision and remaining proof |
| --- | --- |
| Separate injected source guidance from user text (`d6bf138`) | Penglai does not insert community `sourceGuidance`; inbound channel text stays a user message. The existing source/receipt contract was checked in IM integration. Do not copy the community guidance path without a separate trust review. |
| Fence conversation Workspace/Session operations (`6f844da`) | Added an official membership check before local rebind, menu selection, pairing-token use and ordinary inbound use of an existing binding. Added cross-Workspace and moved-Session regression tests. Installed race/reconnect observation remains required. |
| Weixin streaming upload and idle timeout (`3038348`), connection diagnostics (`ec163ca`, `0d36ae3`) | Penglai currently admits encrypted Weixin media at a bounded 8 MiB and has a 30-second transfer timeout plus redacted vendor error classes. A larger streaming file feature is not claimed. Live Weixin file and reconnect diagnostics remain `NOT_RUN`. |
| Feishu final-answer/history/reconnect fixes (`5bb2727`, `a74b777`, `48f077a`) | Keep Penglai's causal receipt/outbox path; its source tests pass. Live account recovery, final-answer timing and thread correlation remain `NOT_RUN`. Do not enable reasoning-stream exposure by inheritance. |
| Telegram retry/Unicode (`857a94f`, `5f6e68d`) | Penglai handles `Retry-After` with a bounded delay and currently accepts private text without group bot-mention offset rewriting. Retry tests pass; live Telegram delivery remains `NOT_RUN`. |
| DingTalk quoted attachment and QQ corrupt-state recovery (`de0c50d`, `03d18e9`) | The current Penglai contract does not claim quoted attachment parity or that community QQ state-file layout. Existing adapter source tests pass; any new capability must get its own admission, persistence and live evidence. |
| New Email/Matrix and public reasoning streams | Not silently added to the existing product claim; these are separate channel/privacy decisions. |

## Review findings and release blockers

1. **Fixed:** 0.1.7 Center could wait on inventory during Loader apply, preventing the Web launch URL. Loader-ready inventory scheduling resolved real startup.
2. **Fixed:** exact 0.1.7 browser auth redirect differed from 0.1.6 and produced HTTP 401 in the old verifier.
3. **Fixed in source:** local control and IM menu/pairing could write a Workspace/Session pair without rechecking official membership. Now each action checks it; an existing binding is checked again before inbound use.
4. **Fixed in the release contract:** the copied 0.6.5 policy excluded installed upgrade. For 0.6.6, 0.6.3 and 0.6.5 installed upgrade are hard Mac/Windows gates. A missing path cannot be counted as PASS.
5. **Fixed in source, awaiting renewed installed proof:** the copied DSH app-boot module made official settings writes fail despite a healthy Web boot. The application runtime remains a complete, pinned official npm cohort; only the redundant profile copy is omitted. The local DMG layout script also now opens the mounted volume in Finder before addressing it by disk name; a small mounted-image probe reproduced and resolved Finder's `-1728` failure.
6. **Fixed in the upgrade verifier, awaiting renewed installed proof:** the immutable 0.6.3 DMG's embedded release information names DSH 0.1.6-alpha.2. A copied verifier assumption named 0.1.5-rc.2 and looked for settings in the wrong Home. The verifier now reads DSH identity from the verified installed asset and checks the active Home before seeding preservation fixtures.
7. **Still required:** native installed onboarding and plugin enable/disable/restart, real 0.6.3/0.6.5-to-0.6.6 migration, third-party manager consent, Weixin/Feishu live-account delivery where credentials are available, Memory-real on a clean source SHA, three target artifacts, and immutable public-byte readback. UOS package/ABI evidence is distinct from UOS native-machine evidence. Public README/site must remain on 0.6.5 until readback.

The source and packaged startup checks are necessary but do not prove the release. Preserve v0.6.5's tag, assets, publication manifest and website download claim unchanged.
