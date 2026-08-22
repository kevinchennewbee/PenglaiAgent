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

## Trust and platform limits

This remains a `community-verified` candidate. macOS packages are ad-hoc signed and not notarized; Windows is not Authenticode signed. Gatekeeper or SmartScreen may warn. Do not disable system security.

Plugin Center stays independent of desktop releases: a later signed catalog generation can refresh plugins without rebuilding the client, but only inside `dsh.exact = 0.1.1-rc.2`.
