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
| `packages/dsh-bridge/src/plugin.ts` `ctx.apiProxy.sessions.*` | Active product | IM/bridge Session creation and model routing | Replace with owner Session Remote; no compatibility ApiProxy | Yes |
| `packages/dsh-bridge/src/index.ts` ApiProxy commentary/route check | Active product | inbound IM Agent calls | Rewrite around official Session Controller and model projection | Yes |
| `@deepseek-ai/dsh-host-apiproxy` closure assumptions | Release gate/active closure | closure/profile scripts | Remove only with new controller packages and clean closure proof | Yes |
| `dsh.client.inject` `@deepseek-ai/dsh-client-runtime` | Active product | ASR, Budget, Companion, IM, Memory, TTS, Office, Center | Replace per-plugin with minimum narrow official graph | Yes |
| `packages/*/src/dsh-client.js` generated/bundled clients | Active product/generated input | plugin packaging and DSH client fibers | Regenerate from source entry and verify exact fiber activation | Yes |
| `packages/dsh-bridge/src/capability-baseline.ts` | Release gate | versions/contracts/closure | Replace rc.2 seam list with generated fixed-set baseline | Yes |
| `scripts/probe-dsh-contracts.mjs`, `probe-rc2.mjs` | Operator/contract verifier | manual and source gates | Retain rc.2 probe as historical rollback input; add 0.1.2 probe | Yes |
| `scripts/embed-runtime.mjs`, closure helpers | Release gate | packaged runtime assembly | Migrate package graph only after tarball reconciliation | Yes |
| `scripts/verify-profile.mjs` | Release gate | profile composition and plugin state | Update for profiles/bundles and exact client fibers | Yes |
| `scripts/apply-overlay.mjs` and overlay manifests | Active build input | patched official Web bytes | Map every hunk to alpha.1 slots; retire obsolete patches | Yes |
| `scripts/verify-bundled-runtime.mjs` | Native/package verifier | packaged DSH closure | Extend for new launcher/profile/auth and exact package graph | Yes |
| `scripts/e2e-installed*.mjs` | Native installed verifier | installed application | Preserve; update behavior only after packaged skeleton exists | Yes |
| `packages/release-identity/src/pins.ts` | Authoritative identity source | manifests, runtime, release gates | Keep authority; reduce hand-maintained derived copies | Yes |
| `release-contract.json` | Current release truth | formal 0.5.7 release | Protected and byte-identical during preview preparation | Later only |

## Independent work inventory

| Asset | Current class | Finding/decision | Immediate action | Acceptance |
| --- | --- | --- | --- | --- |
| `packages/channel-feishu/src/index.ts` callback boundary | Active product | P0-02 | Attach terminal rejection handling before returning accepted | Rejected download/admission cannot become unhandled rejection; durable terminal state is inspectable |
| `apps/desktop/src/supervisor.ts` and Windows helper | Active product | P0-01 | Specify/characterize real DSH child ownership before package changes | Child exit/hang/port loss detected; bounded recovery; no orphan |
| Memory curator runner/session creation | Active product | P0-05 | Map current lifecycle and design internal-job replacement | No false subagent, no cross-Workspace state, no Turn blocking |
| IM channel manifest `live` boolean | Active product | capability-truth finding | Replace with separate entry/runtime/connection/evidence/capability facts | UI and public claim derive from same closed model |
| Active WhatsApp package, adapter, identity, lock entries | Forbidden active surface | D-062 | Remove now from active graph | Source, lock, dependencies, catalog, UI, packaging, tests show absence |

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
| `.github/workflows/source-ci.yml` | Source gate | branch push/PR | Add preview execution and preview invariant check |
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

- Enumerate every overlay patch hunk against the alpha.1 slot catalog.
- Enumerate every `dsh.client.inject` row and its minimum replacement graph.
- Enumerate every ApiProxy, old Session envelope, and reconnect assumption.
- Trace every release identity copy back to the authoritative pin source.
- Map every active/native/operator verifier to a script and workflow invocation.
- Record the exact packaged process tree on Windows and both macOS targets.

These open rows block package migration or release claims where relevant. They
do not block independent preview work already classified above.
