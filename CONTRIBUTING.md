# Contributing to Penglai

Penglai is a desktop distribution of official DeepSeek Harness. Product work happens on a single `main` branch. Do not open feature branches, worktrees, or pull requests unless the repository owner changes that contract.

## Prerequisites

- Node `22.22.2`
- pnpm `10.14.0`
- macOS 13.0+ (macOS 14+ recommended for the current Apple Silicon native runner)
- Do not depend on GitHub Actions. Local or self-hosted native runners are the source of installed evidence.

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

`package:mac` refuses a dirty tree and refuses `HEAD != origin/main`. macOS arm64 and macOS x64 must be built separately. A universal app is not two installers.

## Public export

`pnpm prepare:public-export` builds an allowlisted source tree and `publicExportTreeSha256`. `STATE.md`, evidence, `dist`, and private handoff documents are excluded. Public repo, tag, Release, and updater channel work are not authorized in this repository pass.

## Secrets

Never commit API keys, Weixin tokens, Feishu App Secrets, updater private keys, QR images, chat bodies, or owner absolute paths. Fixture secrets stay in isolated test profiles.

## Language and identity

Fresh installs default to Chinese. English must remain switchable and persistent. New Penglai UI must ship complete zh and en copy. Do not hide official DSH appearance, Models, Workspace, Session, tools, approvals, or settings.
