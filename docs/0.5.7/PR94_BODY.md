# Penglai 0.5.7 release-candidate development

> Publication correction: this file preserves the PR #94 candidate record.
> The final immutable 0.5.7 Release exposes eight Messaging connection entries,
> does not bundle the WhatsApp community runtime, and publishes a 1,212-component
> SBOM. Current release truth lives in `docs/RELEASE_NOTES_0.5.7.md` and
> `docs/PUBLICATION_MANIFEST_0.5.7.md`.

This PR remains **Draft** until the last matching native job and review closeout
complete. The Owner has authorized completion through merge, public
`v0.5.7` Release, download switch, and website deployment; that authorization
does not waive any source, security, native, installed, or public-readback gate.

## Product boundary

- Official DeepSeek Harness `0.1.1-rc.2` remains the only Agent, Session, Turn,
  tool, model, Workspace, and conversation core.
- `@penglai/im` remains the only user-facing Messaging plugin. Nine platform
  adapters run under Penglai's Owner Broker, Vault, Artifact, routing,
  persistence, and privacy contracts. DSH-IM is not installed or bundled.
- Office and Memory remain required first-party plugins. Messaging, ASR, TTS,
  Budget, and Companion stay optional/default-off as documented.

## Current upstream review

- Official DSH: `dsh-v0.1.1-rc.2`, commit
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`; GitHub and npm `latest`/`next`
  were rechecked on 2026-08-26 and remain unchanged.
- DSH-IM current review baseline: unsigned annotated tag `v3.0.5`, tag object
  `63bdfc72be1289097e3c73acb95ba9260531091d`, peeled commit
  `64587b3b6162fa34f1c3ddb335a254d4154c9175`, measured archive SHA-256
  `ae4a9727627f55d5a90bff929caf27dc092153c80b8b79fca9cf18a3fa4125f7`.
- v3.0.3 responsive status placement and the exact international iLink host
  were selectively rewritten. WeCom intermediate thinking/tool output and
  WhatsApp groups were rejected; the group change was also reverted upstream.
- The later unsigned `v3.0.6` release was reviewed on 2026-08-27 without
  re-pinning. Its DSH-IM workspace picker is not shipped by Penglai, and
  Penglai already has bounded Weixin delivery diagnostics. Exact identity,
  archive hash, and decisions are in `dsh-im-v3.0.6.md`.

## What changed

- Main Owner Broker receipts now cover Companion, Memory mutations, IM
  credentials/risk/logout/binding, Artifact persistence, Plugin Center, and
  other high-impact actions. Renderer booleans and model text are not authority.
- Profile activation uses journalled staging/last-good/backup recovery. Windows
  process ownership, orphan reaping, ACL, Job Object, uninstall, and native
  helper behavior are fail-closed.
- The single Messaging page offers nine real adapters. Weixin, Feishu,
  DingTalk, WeCom, QQ, and WhatsApp use real vendor QR/device-link challenges;
  Slack, Telegram, and Discord use official non-QR manifest/token paths.
- Sidecar transports now include durable cursor/ACK behavior, private-only
  ingestion, route-bound replies, restart restore, classified errors, and
  status reactions where the vendor supports them. WhatsApp session state is
  encrypted, serialized, flushed, restored, and wiped on logout.
- Office has structured DOCX/XLSX/PPTX/PDF create/edit/inspect/preview flows,
  ten normal-user templates, immutable Artifact lineage, bounded GC, PDF
  rotate/watermark/merge, and Owner-approved commit/return.
- Memory model mutations are proposal-only candidates; review, accept,
  correction, forget, import, delete scope, provenance, and SOP promotion obey
  Workspace/personal scope and Owner receipts.
- Plugin Center ordinary UI hides implementation permission identifiers;
  advanced diagnostics retain exact technical details.
- Supply-chain records, licenses, NOTICE, SBOM, README, website, and provenance
  acknowledge DSH-IM, qqbot-agent-sdk, PPTFast, ExcelJS, pdf-lib, Noto CJK, and
  the other shipped dependencies without claiming their runtimes are bundled.

## Current local Windows evidence

Executed with embedded Node `22.22.2` and pnpm `10.14.0`:

- format and typecheck: PASS
- core unit matrix: PASS, with only explicit Windows privilege/symlink skips
- channel contract: 119/119 PASS
- IM integration: 52/52 PASS
- desktop E2E/fault paths: 81 total, 80 pass, 1 Windows symlink skip, 0 fail
- security 15/15, chaos 5/5, source soak 1/1: PASS
- dependency, license, secret, SBOM (1,220 components), notices: PASS
- Windows native helper: MSVC x64 build and PE architecture PASS
- embedded DSH closure: 435 packages, exact Windows native payloads, PASS
- local NSIS 3.12 packaging, silent reinstall, Simplified Chinese installer UI,
  embedded identity, fuses, profile, and DSH closure: PASS
- fresh private profile: official DSH HTTP 200, required Office/Memory inventory,
  Plugin Center, shutdown, and zero leftovers PASS
- exact installed welcome: official Penglai UI, privacy-step transition, owned
  DSH process, and zero leftovers PASS
- exact installed plugin lifecycle: required Office/Memory active by default;
  Messaging/ASR/TTS/Budget/Companion enable, survive restart, disable, and
  survive restart PASS; all ordinary settings surfaces are reachable
- Office-real and Memory-real: PASS on a clean candidate
- official DeepSeek live onboarding: model directory, preferred-model select,
  no-echo credential test, first real Turn, final digests, and process ownership
  PASS; no credential or conversation content is written to public evidence

The Windows runtime rebuild now hashes the native helper in the runtime
manifest. The ZIP extractor also uses Windows bsdtar when `unzip` and the
optional PowerShell.Archive module are unavailable. Recursive release scripts
re-enter the exact pnpm CLI instead of resolving an unrelated global pnpm.

## Deliberate evidence boundary

- The live-account matrix remains redacted and marked
  `LIVE_BLOCKED_OWNER_ACCOUNT` for all nine platforms on 0.5.7 bits. A visible
  QR, SDK initialization, or inherited 0.5.6 result is not promoted to a live
  support claim. This is an explicit release boundary, not a fabricated PASS.
- Weixin/Feishu/DingTalk/WeCom/QQ/WhatsApp expose real vendor QR/device-link
  paths. Slack/Telegram/Discord accurately expose their official non-QR
  credential paths; the product does not invent QR login for them.
- macOS is ad-hoc signed and not notarized, and Windows is not Authenticode
  signed. The ordinary UI explains the user action in plain language while the
  README and Release retain the exact trust disclosure.

## Remaining publication sequence

1. Finish the matching Intel macOS native/installed job and close the reviewed
   PR threads.
2. Mark PR #94 Ready and merge only while Source CI, CodeQL, and all three
   native jobs are green.
3. Rebuild all three targets from the resulting immutable `main` SHA, assemble
   the exact release contract, and publish tag/Release `v0.5.7`.
4. Read back every public asset and signed update manifest before changing the
   README and website downloads from v0.5.6 to v0.5.7.

Until those steps finish, no tag, public Release, site deployment, or broad live
platform support claim is made by this document.
