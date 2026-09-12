# Contributing to Penglai

Penglai is a desktop distribution of official DeepSeek Harness. Follow the
current `AGENTS.md` and version contract. Commit, push, PR and merge only with
the user's applicable authorization. Completed 0.5.10 publication does not
authorize rewriting that release. 0.5.11 follows the current product contract.

## Prerequisites

- Node `22.22.2`
- pnpm `11.7.0`
- macOS 13.0+ (macOS 14+ recommended for the current Apple Silicon native runner)
- Native installed evidence still comes from matching-target installers, not from
  `dist` staging. GitHub Actions native jobs are evidence only when they produce
  the exact contract artifacts.

## Required reading before code

Read `PRODUCT_CONSTITUTION.md`, then `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/ACCEPTANCE.md`, and `docs/PUBLICATION_0.5.0.md`. Do not implement a second Agent runtime, a second chat UI, a provider gateway, or a production secret path other than official credentials-local YAML.

## Develop

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:security
```

Installed evidence must come from the exact installer, not from `dist` staging or a source-tree Electron launch:

```bash
pnpm test:e2e:installed
pnpm verify:fuses
pnpm verify:installed
```

## Package

```bash
pnpm package:mac
pnpm build:local-dmg --reuse-app
```

Native packaging still refuses a dirty tree for release artifacts. Apple Silicon
and Intel Mac builds are separate installers; a universal app is not two
installers. 0.6.2 publication excludes Intel Mac. Follow the current version's
acceptance delta, not a historical runbook.

## Public export

`pnpm prepare:public-export` builds an allowlisted source tree and `publicExportTreeSha256`. `STATE.md`, evidence, `dist`, and private handoff documents are excluded. Public tag, Release and updater work require a current-version authorization.

## Secrets

Never commit API keys, Weixin tokens, Feishu App Secrets, updater private keys, QR images, chat bodies, or owner absolute paths. Fixture secrets stay in isolated test profiles.

## Language and identity

Fresh installs default to Chinese. English must remain switchable and persistent. New Penglai UI must ship complete zh and en copy. Do not hide official DSH appearance, Models, Workspace, Session, tools, approvals, or settings.
