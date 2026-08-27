# Penglai 0.5.7 release-candidate development

This PR remains **Draft** while installed/native release evidence is being
completed. The Owner has authorized completion through merge, public
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
- core unit: 706 total, 691 pass, 15 Windows privilege skips, 0 fail
- channel contract: 118/118 PASS
- IM integration: 51/51 PASS
- desktop E2E/fault paths: 78 total, 77 pass, 1 Windows privilege skip, 0 fail
- security 15/15, chaos 5/5, source soak 1/1: PASS
- dependency, license, secret, SBOM (1,220 components), notices: PASS
- Windows native helper: MSVC x64 build and PE architecture PASS
- embedded DSH closure: 435 packages, exact Windows native payloads, PASS
- local NSIS 3.12 packaging and silent reinstall completed on the previous
  candidate SHA; the final SHA is rebuilt after every source change
- fresh private profile: official DSH HTTP 200, required Office/Memory inventory,
  Plugin Center, shutdown, and zero leftovers PASS

The Windows runtime rebuild now hashes the native helper in the runtime
manifest. The ZIP extractor also uses Windows bsdtar when `unzip` and the
optional PowerShell.Archive module are unavailable. Recursive release scripts
re-enter the exact pnpm CLI instead of resolving an unrelated global pnpm.

## Evidence still required before Ready/merge/release

- Commit a clean candidate and regenerate clean-source/public-export evidence.
- Complete installed Windows Setup walk: welcome, optional plugins, all nine
  Messaging cards, restart, update/uninstall, privacy scan, and soak.
- Complete the real DeepSeek onboarding/conversation flow through the installed
  app using a no-echo local credential channel.
- Complete redacted live-account rows. A visible QR or successful SDK init is
  not a live support claim; the full private message → official Turn → original
  route reply → restart restore → logout cleanup loop must pass.
- Independently verify Office artifacts with Poppler/PyPDF plus
  LibreOffice/Microsoft Office. This Windows host uses real Microsoft
  Word/Excel/PowerPoint COM plus `pdfinfo`, PyPDF text extraction, and
  `pdftoppm` rendering; a clean-tree rerun is still required for official PASS.
- Rerun Memory-real on the clean candidate; the real 100k Mnemon corpus/query
  completed, but official PASS is correctly forbidden while the tree is dirty.
- Obtain native Apple Silicon and Intel macOS artifacts from matching runners,
  then run installed, signing/trust, upgrade, and readback gates.
- Push this exact branch, wait for GitHub CI/CodeQL/native checks, resolve any
  failure, and only then move the Draft PR toward review.

No merge, tag, public Release, site deployment, or public support claim is made
by this document.
