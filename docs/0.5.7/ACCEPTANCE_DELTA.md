# Penglai 0.5.7 acceptance delta

This document adds 0.5.7-specific checks to the inherited 0.5.x registry in
`docs/ACCEPTANCE.md` and the 0.5.6 delta. “PASS” is evidence-class specific:
source (S), contract (C), native (N), installed (I), live account (L), and
public bytes/site (P) are not interchangeable.

## Identity and upstream

- `R57-TRUTH-001` — every current product/package/release pin is exact `0.5.7`.
- `R57-TRUTH-002` — official DSH remains `0.1.1-rc.2` with the freeze in
  `packages/release-identity/src/pins.ts`.
- `R57-TRUTH-003` — committed identity is a template (`UNFROZEN` + `sourceSha=NONE`);
  candidate evidence binds a real Git SHA; public docs do not invent hashes.
- `R57-DSHIM-001` — DSH-IM pin is unsigned `v2.5.0` / tag object
  `d910373e1aa77e830bbb4a32544ace972492e79e` / peeled
  `aa8fd71b936a0378604bd0f8f277059833ddb8f7` with tarball SHA-256 recorded.
  v2.4.0 is historical only.
- `R57-DSHIM-002` — `lib/`, `bin/`, `cordis.patch.yml`, harness client, independent
  config store, and DSH-IM Office are absent from Penglai.

## Messaging

- `R57-IM-001` — the user-visible plugin remains one `@penglai/im`.
- `R57-IM-002` — nine platforms expose a real connect/enable surface: weixin,
  feishu, dingtalk, wecom, qq, slack, telegram, discord, whatsapp.
- `R57-IM-003` — ChannelAdapter V2 is a closed contract: enable/disable,
  begin/poll/cancel connection, start/stop, health, sendText, sendArtifact,
  disconnect, logout/delete credentials, inbound callback, capability discovery.
- `R57-IM-004` — connection results are a closed union: QR, OAuth, Manifest,
  Token, Device Link, Manual fallback. Adapters never return SDK objects, raw
  secrets, filesystem paths, generic execute, or arbitrary fetch.
- `R57-IM-005` — enabled and connected are separate. States are disabled,
  not_configured, connecting, connected, degraded, expired, blocked, failed.
- `R57-IM-006` — Slack/Telegram/Discord do not present QR. WhatsApp is
  experimental, community-protocol, default-off, and requires risk acknowledgement.
- `R57-IM-007` — routes include channel, bot/account, vendor target, redacted
  peerRef, Workspace, Session, and binding revision. No first-item / focus /
  recent-session guessing.
- `R57-IM-008` — groups default off, Owner-gated, allowlisted. Unknown sender,
  tenant, chat type, or route fail closed.
- `R57-IM-009` — Weixin/Feishu 0.5.6 accounts and bindings migrate without loss.
- `R57-IM-010` — inbound claim/Turn/correlation uses a stable operation ID;
  one vendor message creates at most one DSH Turn; uncertain send is not blindly
  retried.

## UI

- `R57-UI-001` — the page title is “消息连接” / “Messaging”, not “Penglai IM”.
- `R57-UI-002` — ordinary users see nine platform cards: icon, name, enable,
  plain-language status, connect/scan, redacted account, disconnect/manage.
- `R57-UI-003` — ordinary users do not see `not_configured`, raw binding counts,
  operation IDs, credential refs, stacks, “open config file”, or raw SDK state.
- `R57-UI-004` — advanced settings stay collapsed: binding, commands, voice
  policy, multi-account, queues, diagnostic codes, recovery.
- `R57-UI-005` — dark/light, zh/en, 1024/1280/narrow, Windows 125%/150%, keyboard,
  focus order, screen-reader labels, and high contrast are verified. QR never
  enters screenshots, cache, or evidence.

## Security and reliability

- `R57-OWNER-001` — renderer `ownerConfirmed: true`, UUID strings, and DSH chat
  confirmations are not authority. High-impact actions consume Main receipts.
- `R57-IPC-001` — official DSH Web may use health, microphone grant, Owner
  request, and controlled HTTPS only. Recovery/delete/open-data/update/restart
  stay on wizard/recovery origins with capability and expiry checks.
- `R57-FILE-001` — Workspace Artifact persist requires an Owner receipt. Office
  cannot bypass the Artifact gate. Renderer/model see `artifact:<uuid>` only.
- `R57-CENTER-001` — Plugin Center last-good is an independent immutable snapshot;
  switch happens only after the new snapshot validates. Community code stays
  disabled unless runtime isolation exists.
- `R57-PROF-001` — profile activation uses staging, validate, atomic swap, journal,
  and independent last-good. A crash cannot boot a half profile.
- `R57-SUP-001` — `shouldRestartAfterExit` is wired to the Electron DSH child.
  Exhausted restart budget opens an explicit recovery page.
- `R57-DIST-001` — Windows uninstall uses `resources\runtime\helpers\` on the
  same machine-verifiable path. Full-delete capability is exact, not a substring.
- `R57-SBOM-001` — SBOM contains the full lockfile closure, DSH-IM provenance,
  and new channel dependencies. No `.slice(0, 800)` truncation.

## Live and public

- `R57-LIVE-001` — each platform has a redacted live evidence row or an explicit
  `LIVE_NOT_RUN` / `LIVE_BLOCKED` reason. Mocks do not substitute.
- `R57-PUBLIC-001` — README, notes, and website do not claim nine-platform
  support until the corresponding live rows exist. They do not fill installer
  SHA-256 until public readback.
- `R57-SITE-001` — website sources live on `main` under `website/`. `gh-pages`
  is deploy output only. Production deploy is manual, after `v0.5.7` readback.
