# Penglai 0.5.5

Penglai 0.5.5 is the next local development candidate. It pins official DeepSeek Harness `0.1.1-rc.2` as the only core and keeps three targets: `darwin-aarch64`, `darwin-x86_64`, and `win32-x86_64`.

This document is the UNFROZEN source contract. It does not claim a published GitHub Release.

## Product intent

- 蓬莱办公 and 蓬莱记忆 are required-builtin DSH plugins: present in a fresh profile, inventory `active`, health true.
- 蓬莱手机消息, 蓬莱语音识别, 蓬莱语音生成, and 蓬莱主动陪伴 remain installable and default-off.
- Plugin Center user cards are those six products. Pilot/reference are internal fixtures.
- IM accepts text, image, file, and audio into one official DSH Session.
- Enabling ASR exposes a conversation microphone slot; enabling TTS exposes assistant read-aloud.

## Upgrade paths

- **0.5.1 / 0.5.2 / 0.5.3 users:** Settings → Penglai → Update after 0.5.5 is published, or a same-platform manual overlay. There is no silent auto-update.
- **0.5.0:** manual overlay only; 0.5.0 has no production updater trust path.
- A completed 0.5.1 profile can use **Penglai → Update**. A fresh 0.5.1 profile may still be blocked by the rc.1 workspace-path gate and needs a manual overlay.

All paths preserve the `Penglai/0.5` data generation and external Workspaces. The updater verifies the Penglai Ed25519 signature and exact installer hash.

## Locally proven on Apple Silicon (unpublished)

These items have local evidence on `darwin-aarch64`. They are not a published Release claim.

- Official DSH `0.1.1-rc.2` boots from the exact `Penglai_0.5.5_macos_aarch64.dmg`. Fresh inventory has Office and Memory `active`; IM/ASR/TTS/Companion stay default-off and can be enabled then disabled without dropping the builtins.
- Bundled Mnemon 0.2.4 is the arm64 binary in app resources. Archive hash and binary hash are separate fields. `remember` / `search` / `forget` run from that binary, not from the repo checkout.
- Memory conversation tools declare official DSH `output.{schema,render}`. Search is scoped to personal + current Workspace. Missing Mnemon must not take down DSH HTTP.
- Office conversation tools inspect/create/plan/preview/commit/undo without model-supplied paths. Packed CJK uses the complete, hashed upstream OFL `NotoSansSC-VF.ttf`.
- IM images use official `ctx.attachments.saveImage`. Office files and audio stay Penglai handles.

Still awaiting before product publication: Intel Mac native, Windows native, the temporary-provider nonce Turn, GitHub CodeQL on this branch, and final three-target release readback. Live WeChat/Feishu account evidence remains a separately labelled external-account limit and is not replaced by mocks. The repository-embedded updater and plugin public keys have been matched to the owner-held offline private keys without exposing key material.

## Trust and platform limits

This remains a `community-verified` candidate. macOS packages are ad-hoc signed and not notarized; Windows is not Authenticode signed. Gatekeeper or SmartScreen may warn. Do not disable system security.

Plugin Center stays independent of desktop releases: a later signed catalog generation can refresh plugins without rebuilding the client, but only inside `dsh.exact = 0.1.1-rc.2`.

The immutable signed [`plugin-catalog-v1.000005`](https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/tag/plugin-catalog-v1.000005) contains `@penglai/office-reader` 0.1.3 for DSH 0.1.1-rc.2. The production distribution path has refreshed it from GitHub, verified the catalog and package signatures, downloaded the exact asset, installed it disabled, and recovered the signed last-good catalog offline. The old Pilot test package is not listed as a user product.
