# DSH 0.1.2-alpha.1 fixed source baseline

> Evidence date: 2026-08-29. This document binds Penglai 0.5.8 preview work to
> one upstream source tree. It is source evidence only.

## Owner decision

Penglai 0.5.8 uses this exact upstream source baseline:

| Field | Fixed value |
| --- | --- |
| Repository | `https://github.com/deepseek-ai/deepseek-harness.git` |
| Tag | `dsh-v0.1.2-alpha.1` |
| Git object type | lightweight tag resolving to `commit` |
| Commit | `cd5ef8148158c3a752a658978873241fdf8e2bbc` |
| Tree | `a712eec535b48badc4fefb4df5176a7002e4280b` |
| `git archive` SHA-256 | `1fe7d2380d3e53eac2f6ee92ee5c81850ddc9b735b5910bae132cf1fc12b7211` |
| Source version | `0.1.2-alpha.1` |
| Source package manager | `pnpm@11.7.0` |
| Source Node requirement | `^22.19.0 || >=24.0.0` |

The commit, not the movable tag name, is authoritative. If the tag later
resolves elsewhere, reconciliation must fail closed and require a new Owner
decision.

## Clean source verification

The upstream repository was cloned at the exact tag into a disposable directory
outside the Penglai checkout. No upstream source was modified or copied into
Penglai.

| Check | Result |
| --- | --- |
| Detached checkout at exact commit | PASS |
| Clean upstream worktree before verification | PASS |
| Host environment | macOS arm64 |
| Node | `22.22.2` |
| Corepack-selected pnpm | `11.7.0` |
| `pnpm install --frozen-lockfile` | PASS |
| Lockfile supply-chain policy | PASS, 1,292 entries checked by upstream |
| Workspace scope | 265 projects |
| `pnpm run build` | PASS |
| Host libraries and CLI | PASS |
| Client libraries and generated Remote client | PASS |
| DSH Web frontend | PASS |

The install reported expected host-platform warnings for Linux-only native
workspaces and pre-build CLI link warnings that disappeared after the CLI was
built. They were warnings, not failed checks. The build also reported bundle
size and bundler timing hints; those are upstream observations, not Penglai
release failures.

## Source architecture facts used by Penglai

- All supported Node applications launch through `dsh` plus a named profile.
  Penglai must not create a direct in-process application tree or second Host.
- Profiles stack ordered bundles and patch files. Product composition remains a
  DSH profile, not an Electron-owned plugin runtime.
- The broad Host ApiProxy package is removed. Business controllers expose typed
  `@Remote` methods through the Remote BFF and Gateway.
- The former client-runtime facade is removed. Client composition uses narrower
  packages, modules, stores, and typed slots.
- Session Controller owns list, search, create, model catalog/selection, rename,
  fork, prompt, attachment, queue, cancel, page, follow, and control operations.
- Session projection owns durable title, model, preset, and subagent facts.
- The Attachment seam covers durable image admission/projection. It is not a
  general audio/video Turn API.
- Plugin inventory exposes effective lifecycle phases, but Penglai still owns
  its signed catalog transaction, rollback, and owner-facing diagnosis.
- Model-visible input must be reconstructable from the durable Session log.
- Experimental Agent Teams and private WebWorker paths are not production
  Penglai integration targets.

## Package-tree delta from 0.1.1-rc.2

Tree comparison found 254 package manifests under `packages/` in alpha.1 versus
234 in rc.2. Twenty-five manifest paths were added and five removed.

Removed paths with direct Penglai impact:

- `packages/host/apiproxy/package.json`
- `packages/client/runtime/package.json`

Other removed paths are examples or test support. Added paths with direct
Penglai impact include:

- `packages/api/session-controller/package.json`
- `packages/api/settings-controller/package.json`
- `packages/api/workspace-controller/package.json`
- `packages/client/store/package.json`
- `packages/client/ui-approval/package.json`
- `packages/client/ui-chat/package.json`
- `packages/client/ui-session/package.json`
- `packages/llm/plugin-package-inventory-deepseek/package.json`
- `packages/subprocess/win32-process/package.json`
- `packages/util/crypto/package.json`
- `packages/util/workspace-path/package.json`

The numerical delta is discovery evidence, not a dependency list. The exact
published closure must come from official package tarballs.

## Current npm boundary

At the evidence date:

- the GitHub prerelease and source tag exist;
- the GitHub release has no uploaded package assets;
- npm `@deepseek-ai/dsh@0.1.2-alpha.1` does not exist; and
- npm `latest` and `next` still resolve to `0.1.1-rc.2`.

Therefore Penglai keeps all active DSH manifest and lockfile pins at
`0.1.1-rc.2`. A Git URL, file path, source-built tarball, copied `lib/`, or
private registry substitute is forbidden as product closure.

## Manual publication reconciliation

No monitor is created. When the official npm set is known to exist, perform one
manual reconciliation:

1. Re-resolve the tag and require the fixed commit and tree above.
2. Enumerate every direct and transitive DSH package required by Penglai.
3. Record exact version, dist integrity, tarball digest, publish time, license,
   engines, dependencies, peer dependencies, and exported files.
4. Require every package to belong to one synchronized compatible set.
5. Compare generated Remote/client artifacts and public declarations with this
   fixed source tree.
6. Reject missing, partially published, retracted, republished, or mismatched
   packages.
7. Change Penglai manifests and lockfile in one reviewable commit.
8. Re-run clean frozen installation, package closure, license, SBOM, source,
   native, installed, and live gates at their proper evidence levels.

## Evidence limits

This baseline proves only that the selected upstream source identity was
resolved and that its clean source install/build passed once on macOS arm64.
It does not prove:

- npm publication or tarball equivalence;
- Penglai compilation or runtime compatibility;
- a native Penglai package on any target;
- installed behavior, real-account connectivity, or live model behavior;
- notarization, Authenticode, or public-release bytes; or
- that any upstream feature automatically fixes a Penglai defect.
