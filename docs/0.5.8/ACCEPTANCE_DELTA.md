# Penglai 0.5.8 acceptance delta

This delta supplements `docs/ACCEPTANCE.md` and the immutable 0.5.7 release
records. Source (S), package (K), native (N), installed (I), Owner-live (L),
public byte (P), and live site (W) are independent evidence classes.

## Fixed DSH source and package closure

- `P058-SC-001` (S/K): the official lightweight tag resolves to the fixed
  commit and tree; source archive, closure manifest, CLI tarball, and all 251
  package hashes match the committed contract.
- `P058-SC-002` (K): every active `@deepseek-ai/*` dependency resolves through
  the audited custom local source resolver. No registry, Git, source checkout,
  copied `lib/`, workspace link, or mixed rc.2 fallback is accepted.
- `P058-SC-003` (K): the embedded runtime launches the source-built official
  CLI as `0.1.2-alpha.1`; every selected top-level dependency and every
  package-local version conflict survives materialization.
- `P058-SC-004` (S/K): licenses, SBOM, notices, package identity, versions, and
  digests derive from the exact closure. Penglai does not impersonate official
  npm publication.

## DSH ownership migration

- `P058-DSH-001` (S/K): active Session operations use the alpha
  SessionController; active code has no rc.2 ApiProxy path.
- `P058-DSH-002` (S/K): Workspace order, immutable Session IDs, visible title
  projections, model catalog, and model selection stay with their official
  owners.
- `P058-DSH-003` (K/I): all eight first-party client plugins inject the exact
  narrow Remotes/settings/slot graph and their expected client fibers become
  active. `dsh-client-runtime` is absent from active manifests and packed
  descriptors.
- `P058-DSH-004` (K/I): official conversation text/image admission, request
  extension preparation, cancellation, restart, and model routing work without
  a Penglai conversation fallback.

## Required product and optional isolation

- `P058-REQ-001` (K/I): fresh profile reaches official DSH Web; credentials,
  Plugin Center, Office, and Memory are exact, enabled, active, and healthy.
- `P058-REQ-002` (I/L): Office inspect/create/edit/preview/save/undo and Memory
  curate/recall/correct/forget/revoke pass with Workspace isolation and
  action-bound Owner confirmation.
- `P058-OPT-001` (K/I): IM, ASR, TTS, Budget, and Companion are independently
  absent/disabled/enabling/active/degraded/failed/cancelled/disabled/rolled
  back without destabilizing DSH, Office, or Memory.
- `P058-OPT-002` (L): live platform and voice capabilities are claimed only from
  matching Owner-account evidence; source packages and mocks do not promote
  them.

## 0.5.7 defect replay

- `P058-BUG-001` (N/I): DSH child death, hang, port loss, retry exhaustion, and
  owner exit converge without a stranded window or orphan process.
- `P058-BUG-002` (I/L): Feishu asynchronous media failures are contained and
  durable; image/voice succeeds only with real permission, non-empty bytes,
  official attachment/text Turn, and safe recovery.
- `P058-BUG-003` (I): Memory maintenance creates no false Agent, Session,
  subagent, or visible Job while real DSH lifecycle remains accurate.
- `P058-BUG-004` (I/L): ASR state/recording feedback, TTS cancellation/first
  sound, IM connection result, Session titles, locale/error boundaries, and
  resource-pressure accounting are verified on installed clients.
- `P058-BUG-005` (N/I): fixes retained from 0.5.7 are removed only when alpha.1
  owns the class and differential evidence proves the Penglai workaround is no
  longer needed.

## Native, public, and site completion

- `P058-NATIVE-001` (N/I): Apple Silicon, Intel macOS, and Windows x64
  installers come from one clean final `main` SHA on matching native runners.
- `P058-NATIVE-002` (N/I): from-installer identity, architecture, fuses,
  signatures/trust limitations, process tree, upgrade, rollback, and uninstall
  pass for every target.
- `P058-PUBLIC-001` (P): `v0.5.8` contains exactly ten immutable assets and
  public readback matches accepted SHA-256 values and signed metadata.
- `P058-PUBLIC-002` (P/W): README, release notes, publication manifest, Chinese
  website, and English website use only observed public facts and honest live
  limitations.
- `P058-PUBLIC-003` (W): both live languages and all installer URLs pass HTTP
  readback; no current 0.5.7/rc.2 download claim remains.
