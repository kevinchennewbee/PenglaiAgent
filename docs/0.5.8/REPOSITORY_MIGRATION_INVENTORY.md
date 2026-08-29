# Penglai 0.5.8 repository migration inventory

> Snapshot: 2026-08-29. This inventory classifies active source and external
> entry points before migration or removal. A missing ordinary import is not by
> itself proof that an asset is dead.

## Classification vocabulary

| Class | Meaning | Retention rule |
| --- | --- | --- |
| Active product | Loaded or packaged into the user product | Must migrate, be explicitly retired, or remain with tests |
| Release gate | Invoked by release/CI/operator flow | Keep until its replacement proves the same evidence class |
| Native verifier | Runs against a target package or installation | Cannot be replaced by source tests |
| Operator tool | Deliberately invoked outside ordinary imports | Needs owner, input contract, privacy boundary, and invocation record |
| Migration compatibility | Reads or transforms older supported state | Needs supported versions and retirement condition |
| Fixture/test support | Deterministic test-only input or helper | Must never be presented as installed/live proof |
| Historical record | Immutable release/provenance documentation | Preserve, but remove from current product wiring and claims |
| Forbidden active surface | Conflicts with an accepted Owner decision | Remove from current source, package, UI, dependency, and test graph |

## DSH migration inventory

| Asset or pattern | Current class | Invocation/consumer | 0.5.8 disposition | Package gate |
| --- | --- | --- | --- | --- |
| `apps/desktop/package.json` `@deepseek-ai/dsh` | Active product | desktop packaged closure | Keep rc.2 until official reconciliation; then exact fixed-set update | Yes |
| `packages/dsh-bridge/src/rc2-owner-adapter.ts` `ctx.apiProxy.sessions.*` | Active rc.2 compatibility | IM/bridge Session creation and model routing before package reconciliation | Confined to version-named adapter; retire when published owner Remote adapter passes | Yes |
| `packages/dsh-bridge/src/owner-ports.ts` and `index.ts` | Active product | inbound IM Agent and directory calls | Agent/Workspace/Session owners split; bind to generated alpha clients after npm reconciliation | Yes |
| `@deepseek-ai/dsh-host-apiproxy` closure assumptions | Release gate/active closure | closure/profile scripts | Remove only with new controller packages and clean closure proof | Yes |
| `dsh.client.inject` `@deepseek-ai/dsh-client-runtime` | Active product | ASR, Budget, Companion, IM, Memory, TTS, Office, Center | Replace per-plugin with minimum narrow official graph | Yes |
| `packages/*/src/dsh-client.js` generated/bundled clients | Active product/generated input | plugin packaging and DSH client fibers | Regenerate from source entry and verify exact fiber activation | Yes |
| `packages/dsh-bridge/src/capability-baseline.ts` | Release gate | versions/contracts/closure | Replace rc.2 seam list with generated fixed-set baseline | Yes |
| `scripts/probe-dsh-contracts.mjs`, `probe-rc2.mjs` | Operator/contract verifier | manual and source gates | Retain rc.2 probe as historical rollback input; add 0.1.2 probe | Yes |
| `scripts/embed-runtime.mjs`, closure helpers | Release gate | packaged runtime assembly | Migrate package graph only after tarball reconciliation | Yes |
| `scripts/verify-profile.mjs` | Release gate | profile composition and plugin state | Update for profiles/bundles and exact client fibers | Yes |
| `scripts/apply-overlay.mjs` and overlay manifests | Active build input | patched official Web bytes | 12 dispositions now cover all files/assets; retire official-route/non-semantic patches and retain only proven narrow gaps after npm readback | Yes |
| `scripts/verify-bundled-runtime.mjs` | Native/package verifier | packaged DSH closure | Extend for new launcher/profile/auth and exact package graph | Yes |
| `scripts/e2e-installed*.mjs` | Native installed verifier | installed application | Preserve; update behavior only after packaged skeleton exists | Yes |
| `packages/release-identity/src/pins.ts` | Authoritative identity source | manifests, runtime, release gates | Keep authority; reduce hand-maintained derived copies | Yes |
| `release-contract.json` | Current release truth | formal 0.5.7 release | Protected and byte-identical during preview preparation | Later only |

## Independent work inventory

| Asset | Current class | Finding/decision | Immediate action | Acceptance |
| --- | --- | --- | --- | --- |
| `packages/channel-feishu/src/index.ts` callback boundary | Active product | P0-02 | Attach terminal rejection handling before returning accepted | Rejected download/admission cannot become unhandled rejection; durable terminal state is inspectable |
| `apps/desktop/src/supervisor.ts`, recovery surface, proxy, and Windows helper | Active product | P0-01 | Dual lifetime wait, fail-closed helper handshake, live facade state, stable restart port, rc.2/alpha authenticated health, real restart-budget exhaustion, non-stranding actions, and bounded redacted diagnostics implemented; package/native work continues | Child exit/hang/port loss detected; private token exchange; bounded recovery; safe terminal action; no orphan |
| Memory curator runner/session creation | Active product | P0-05 | Source replacement implemented: bounded Memory-owned queue plus one direct official no-tools LLM request; optional Budget accounting, one transient retry, digest-only audit; alpha.1 Jobs rejected as visible | No false subagent/Job, no duplicate or cross-Workspace commit, no Turn blocking; package/installed/live proof remains |
| IM channel manifest `live` boolean | Active product | capability-truth finding | Source replacement implemented across registry, Host Remote, settings client, bridge, and bundled sidecar adapters: entry/mode/runtime/connection/release/capability facts are separate and current release evidence is source-only | Preview gate prevents ambiguous field/card drift; package, installed, Owner-live, and public claims still require their own evidence |
| Active WhatsApp package, adapter, identity, lock entries | Forbidden active surface | D-062 | Removed in preview checkpoint | Source, lock, dependencies, catalog, UI, packaging, tests show absence |

## Executable DSH seam census

The fixed-source migration seam is recorded in
`docs/0.5.8/DSH_MIGRATION_INVENTORY.json` and checked by
`scripts/verify-058-migration-inventory.mjs` on every preview gate run. The
census records literal reference counts rather than only package names, so a
new caller in an already-known file cannot bypass review.

| Legacy seam | Current observed surface | Fixed-source owner | Current decision |
| --- | --- | --- | --- |
| `apiProxy` / `@deepseek-ai/dsh-host-apiproxy` | 10 source, test, commentary, closure, and probe files; the active request shape is confined to one rc.2 adapter | `@deepseek-ai/dsh-api-session-controller`, `ctx.remote.session` | Penglai owner ports and rc.2 containment complete; generated alpha adapter remains npm-blocked |
| `@deepseek-ai/dsh-client-runtime` | 8 plugin manifests plus 8 matching packager rows | split among Session/Workspace controllers, Client Store, and narrow UI/composition packages | Consumer map complete; exact inject replacement remains npm-blocked |
| `workspaceRegistry` | 29 production, test, and package-verifier files | `@deepseek-ai/dsh-api-workspace-controller`, `ctx.remote.workspace` | Direct-read map complete; migrate only with published generated clients |
| direct settings provider | 1 onboarding source file with 8 reads/writes | `@deepseek-ai/dsh-api-settings-controller`, `ctx.remote.settings` | Consumer map complete; shared client mirror still package-gated |
| packaged DSH process ownership/authentication | runtime, desktop, proxy, native-helper, surface, and focused fixture files | Penglai desktop/runtime policy over official DSH browser auth and platform-native ownership | Child-exit, continuous authenticated HTTP health, same-port restart, private token exchange, proxy cookie injection, structured diagnostics, exact exhaustion, and recovery-page routes fixed in source; exact alpha package and native process-tree evidence remain |
| Memory curator lifecycle | 7 source files and 7 focused test files | Official `ctx.llm.stream` for the model call; Penglai Memory for internal scheduling/audit/commit; optional Penglai Budget for reservation and exact usage | Agent/Session creation removed; queue bounds, timeout retry, cancellation, exact scope, direct no-tools request, Budget settlement/release, redacted audit, and Jobs rejection are executable; package/installed/live proof remains |
| IM support truth | authoritative registry, six bundled sidecar adapters, IM bridge/Host Remote, settings client, focused tests, and one composed verifier | Penglai channel packaging and account adapters; official DSH remains the sole Agent/session core | Ambiguous `live` is removed; closed entry, adapter mode, runtime bundle, connection, release, and capability facts are executable; every current release row is source-only | Package/installed/Owner-live/public evidence remains separate and must never be inferred from source tests |

The alpha.1 source confirms `sessions.create -> session.create`,
`sessions.models -> session.modelCatalog`, and
`sessions.selectModel -> session.selectModel`. This is a source mapping, not an
authorization to imitate generated Remote declarations or copy upstream build
artifacts.

The source checkpoint also verifies this mapping directly with
`scripts/verify-dsh-alpha-owner-remotes.mjs` against the exact clean alpha
commit. Local bridge tests prove Workspace-owned order plus Session-owned title
projection and title forwarding at the creation boundary. They do not substitute
for the unpublished generated Remote client or package/native evidence.

## WhatsApp retirement boundary

Remove from the 0.5.8 active graph:

- `packages/channel-whatsapp/`;
- `packages/im/src/adapters/whatsapp.ts` and its test;
- `whatsapp` from `ChannelId`, `AdapterName`, manifests, guided steps, Remotes,
  host risk acknowledgements, credential cleanup, and UI copy;
- package/TypeScript workspace references and contract test globs;
- Baileys, libsignal, and `whatsapp-rust-bridge` lockfile closure;
- active license-audit, package, catalog, profile, and acceptance checks that
  treat WhatsApp as a product target.

Preserve as historical records:

- published 0.5.7 tag, Release, assets, release notes, acceptance/runbook,
  publication manifests, and provenance ledgers;
- old ADRs and decisions when clearly labeled historical or superseded; and
- Git history containing the retired implementation.

### Implemented preview checkpoint (2026-08-29)

- Deleted the complete tracked `packages/channel-whatsapp/` workspace and the
  `packages/im` compatibility adapter instead of leaving dormant source.
- Removed the channel from contract/registry identities, credentials, reactions,
  guided connection, Host and Typert Remote methods, Owner risk actions, client
  sections/cards/copy, test matrices, and TypeScript/workspace graphs.
- Regenerated `pnpm-lock.yaml` with the still-published DSH `0.1.1-rc.2` pins.
  The retired workspace, Baileys, libsignal, and Rust bridge closure are absent.
- Replaced the former non-bundle license exception with a fail-closed absence
  policy; generated notices and packaged plugin staging contain no retired
  runtime identity.
- Added `scripts/verify-retired-channel-absence.mjs`, composed into the preview
  invariant gate. It currently checks 405 active source files, 69 dependency
  graph files, four forbidden package identities, and the removed source paths.
- Fresh IM bot schemas no longer create a risk-acknowledgement field. On upgrade,
  unsupported legacy route/bot rows are retained for audit but cannot remain
  active, occupy a Session binding, or re-enter current product lists.

Local evidence for this checkpoint: frozen install, formatting, typecheck, unit,
contract, integration, license audit, SBOM/notice generation, plugin packaging,
and both preview/absence gates pass. Native installers, installed behavior, live
owner accounts, public release bytes, and DSH `0.1.2-alpha.1` npm integration
remain deliberately unclaimed.

Current README/site/architecture still describe the immutable 0.5.7 product.
They stay byte-identical during preview work; future 0.5.8 public copy is written
only during an authorized release phase and must not describe WhatsApp as a
disabled or future platform.

## Evidence and release assets

| Path family | Class | Owner/invocation | Preview rule |
| --- | --- | --- | --- |
| `scripts/verify-*.mjs` | Release/native/operator verifier, per script | package, installed, live, or public gate | Inspect invocation before editing; preserve evidence level |
| `scripts/evidence-*.mjs`, schemas | Evidence writer/validator | release or operator flow | Keep privacy limits and version chain; do not mass-delete |
| `scripts/package-*.mjs`, `assemble-release.mjs` | Release builder | authorized release workflow | No 0.5.8 package/release invocation before Gate P0 |
| `.github/workflows/native-release-candidate.yml` | Native release gate | GitHub Actions | Protected and byte-identical in source-preparation phase |
| `.github/workflows/deploy-website.yml` | Public deployment | GitHub Actions | Protected and byte-identical in preview phase |
| `.github/workflows/source-ci.yml` | Source gate | branch push/PR | Preview execution and composed preview invariants are active and passing |
| `docs/0.5.7/**` | Historical/current release truth | public audit | Preserve unchanged except a separately authorized factual erratum |
| `docs/0.5.8/**` | Preview development truth | current branch | Update with source evidence and work status; never call it release proof |
| `evidence/**` and local captures | Evidence inputs | target-specific verifiers | Never commit private live data or use stale evidence for 0.5.8 |

## Decomposition boundaries

Large files are not refactored merely because of size. Extraction is permitted
when the migration or a class-level fix establishes a real ownership seam:

- process child ownership, health transition, and restart policy from desktop
  supervision;
- profile/source identity generation from repeated package copies;
- channel capability truth from UI manifest convenience fields;
- media download/admission terminal state from vendor callback mechanics; and
- Memory maintenance-job lifecycle from user-visible Agent/subagent projection.

Each extraction must preserve behavior with focused characterization tests
before altering it.

## Open inventory work

- Derive the minimum replacement for every inventoried `dsh.client.inject` row
  after the matching published exports can be inspected.
- Turn the inventoried Session envelope and reconnect expectations into focused
  migration tests when the generated Remote clients are published.
- Trace every release identity copy back to the authoritative pin source.
- Map every active/native/operator verifier to a script and workflow invocation.
- Record the exact packaged process tree on Windows and both macOS targets.
- Design auxiliary model-call accounting against the optional Budget plugin
  without creating an Agent, Session, or visible Job.

These open rows block package migration or release claims where relevant. They
do not block independent preview work already classified above.

The overlay inventory itself is complete in `OVERLAY_TO_SLOT_MAP.json` and is
enforced by `scripts/verify-058-overlay-map.mjs`. It identifies four source
gaps rather than assuming every new alpha slot is sufficient: IM voice-row
projection, hero copy, hero background, and durable TTS message resolution.
