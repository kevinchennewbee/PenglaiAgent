# ADR 0041 — Nine-channel connection and support levels

- Status: Accepted
- Date: 2026-08-25

## Context

0.5.6 told the truth that only Weixin and Feishu were live, and showed seven
other platforms as roadmap with no Connect action. 0.5.7 must offer real
connection entries for all nine without lying about live capability.

## Decision

1. Every platform has a connect/enable card. Roadmap-only copy is removed.
2. `live` means release-accepted code capability, not “user enabled”.
3. Support requires: real connect or authorize; inbound private text; correct
   official Workspace/Session; outbound reply; restart restore; safe
   logout/unbind/delete credentials; no cross-account/Workspace/Session mix.
4. Image/file/audio/Markdown/thread/group stay `false` until live evidence.
5. Connection methods are a closed union: QR, OAuth, Manifest, Token, Device
   Link, Manual fallback. Slack/Telegram/Discord must not fake QR. QQ is
   official Bot QR, never personal QQ login. WhatsApp is not WhatsApp Cloud API.
6. WhatsApp: `supportLevel: experimental`, `risk: community-protocol`,
   default-off, explicit risk acknowledgement version and time.
7. Groups default off, Owner-gated, allowlisted. Unknown sender/tenant/chat
   type/route fail closed.

## Consequences

- README/website/Release may not say “all nine supported” while
  `LIVE_IM_MATRIX.md` still shows `LIVE_NOT_RUN`.
- Weixin 1800-character segmentation may be adopted; iLink stays.
