# Penglai 0.5.6 acceptance delta

This document adds 0.5.6-specific checks to the inherited 0.5.x acceptance
registry in `docs/ACCEPTANCE.md`. “PASS” is evidence-class specific: source (S),
contract (C), native (N), installed (I), live provider/account/device (L), and
public bytes/site (P) are not interchangeable.

## Memory

- `R56-MEM-AUTO-001` — fresh mode is smart automatic Workspace memory, not an
  empty manual-only surface.
- `R56-MEM-AUTO-002` — the curator is a separate official DSH Agent using the
  same provider/model context, with every tool denied and host-side closed JSON
  validation.
- `R56-MEM-AUTO-003` — secret, sensitive, injection-like, or malformed output is
  skipped without failing the user's Turn.
- `R56-MEM-AUTO-004` — safe project memory is persisted only in the current
  official Workspace and becomes recallable on a later pre-step.
- `R56-MEM-AUTO-005` — personal/global memory is never inferred into the
  personal scope; it requires a visible Owner action.
- `R56-MEM-AUTO-006` — recall combines current-Workspace records and explicitly
  accepted personal records, never another Workspace.
- `R56-MEM-AUTO-007` — source revoke is proposed in the renderer, approved in
  Electron Main, revalidated by the host, and completed only after derived index
  removal.

## Owner actions and artifacts

- `R56-OWNER-001` — Office, Memory, IM, Plugin Center, and artifact persistence
  consume one Main-process approval broker; renderer booleans or UUID-shaped
  strings are not authority.
- `R56-OWNER-002` — an approval binds action, object, Workspace, Session where
  applicable, destination, revision/digest, and expiry; mutation, replay, scope
  drift, and permission-digest changes fail closed.
- `R56-OWNER-003` — reservations are completed only after the real mutation,
  delivery, profile transaction, rollback, or deletion succeeds.
- `R56-FILE-001` — Office and IM bytes use opaque `artifact:<uuid>` references;
  filesystem paths never enter model-facing or renderer-facing values.
- `R56-FILE-002` — the same bytes admitted in different Workspaces remain
  distinct bindings; legacy digest IDs are accepted only when unambiguous.
- `R56-FILE-003` — extension/magic mismatch, symlink/device/directory intake,
  macro/encrypted/executable/nested archives, size limits, and scope drift fail
  closed.
- `R56-FILE-004` — ordinary conversation-composer files are not advertised:
  official DSH rc.2 exposes image Turn attachments only. Existing official image
  behavior remains unchanged.

## Messaging, voice, and product truth

- `R56-IM-001` — only Weixin and Feishu are live adapters in 0.5.6.
- `R56-IM-002` — DingTalk, WeCom, QQ, Slack, Telegram, Discord, and WhatsApp are
  visibly roadmap-only; they have no Connect action and cannot bind or send.
- `R56-IM-003` — no platform receives a fake QR shortcut. WhatsApp remains
  default-off and explicitly labelled community-protocol/account risk.
- `R56-IM-004` — admitted inbound file/audio bytes are attached only after the
  official DSH Turn is accepted; an artifact callback failure cannot duplicate
  the Turn.
- `R56-VOICE-001` — Settings preview and conversation Read use one playback
  controller with latest-wins, play/stop/end/error/stalled state, and URL cleanup.
- `R56-VOICE-002` — Read speaks the original assistant text; it is not a
  translation feature.
- `R56-VOICE-003` — microphone permission is audio-only and requires a current
  user gesture. Camera, Bluetooth, and unrelated capture permissions are absent
  from packaged metadata.
- `R56-CENTER-001` — Plugin Center repository, documentation, and issue links are
  signed HTTPS values, confirmed by the user, and opened by Electron Main.

## Distribution, privacy, and public evidence

- `R56-DIST-001` — workflow, NSIS source, license copy, package identity, exact
  assets, and public documents all say 0.5.6.
- `R56-DIST-002` — Apple Silicon, Intel Mac, and Windows x64 installers come from
  one clean source SHA on matching native runners.
- `R56-DIST-003` — each target passes installed welcome/process and first-party
  plugin lifecycle. Windows additionally provides native Simplified Chinese
  installer UI evidence.
- `R56-PRIV-001` — tracked source, public export, packages, evidence, and release
  assets contain no credential, private key, local owner path, QR, chat body,
  account ID, test profile, or private media.
- `R56-PUBLIC-001` — immutable `v0.5.6` contains exactly ten assets and public
  readback verifies every byte, hash, source/tag binding, manifest signature,
  and installer signature.
- `R56-PUBLIC-002` — README, release notes, publication manifest, and production
  website are English first and Chinese second, disclose unsigned/not-notarized
  limits, and distinguish the two live IM platforms from seven roadmap entries.
