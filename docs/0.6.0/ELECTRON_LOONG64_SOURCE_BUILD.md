# Electron 43.6.0 linux-loong64 source-build recipe (new-world only)

**Not the UOS 20 client path.** Confirmed Owner host is UnionTech desktop
OS 20 Professional 1070, kernel `4.19.0-loongson-3-desktop` (old-world).
darkyzhou/AOSC Electron 43 requires glibc ≥ 2.38 and LSX. This recipe
stays as a new-world builder note only. See `docs/0.6.0/UOS.md`.

This is a portable recipe, not native UOS PASS. Official Electron
`43.6.0` has no `linux-loong64` zip. Penglai Mac/Windows stay on that
exact upstream identity; the UOS target must rebuild the same version
rather than sealing on a different Electron train.

Do not use GitHub `loong64/node` rebuilds for Node. Node is pinned to
the Node.js unofficial-builds project (see `NODE_LOONG64.json`).

## Bootstrap only: darkyzhou 43.4.1

Published community zip (MIT, glibc >= 2.38, LSX, New-World):

- URL: `https://github.com/darkyzhou/electron-loong64/releases/download/v43.4.1/electron-v43.4.1-linux-loong64.zip`
- SHA-256: `58c900f8c38d42290fb4bdc0dc3df90a5977efd96aa39f06ce4bf4345a2fc4e9`

Use this zip only to bootstrap `electron` npm / smoke a builder host.
Do not write it into `release-contract.json` or seal four 0.6.0 targets
on 43.4.1. It is two patch trains behind 43.6.0.

## Builder images (darkyzhou, Electron 43 / Chromium 150)

Sourced from `darkyzhou/electron-loong64` `dev` README (2026-09-09):

| Image | Role |
| --- | --- |
| `ghcr.io/darkyzhou/electron-buildtools:crimson-node-24` | update/sync. Native Loong64 buildtools for Electron 42/43, Deepin crimson, Node.js 24. `scripts/sync.sh` needs binfmt for x86_64 CIPD/depot_tools host binaries. |
| `ghcr.io/darkyzhou/electron-builder:crimson-llvm-23-rustc-196` | compile/package Electron 43 / Chromium 150. LLVM 23, Rust 1.96 nightly, Node.js 24.12.0, Chromium 150 GN revision. |

Older images (`crimson-llvm-23-rustc-195` for 42.x, Deepin 25 LLVM 20/21
for 37.x/39.x) are not the 43.6.0 recipe.

## Host constraints

- Linux **Loong64** host (not a Mac cross-build, not QEMU-as-PASS)
- Docker with docker-buildx
- binfmt for x86_64 Chromium host tools
- Minimum **32 GiB RAM** and **200 GiB** free disk
- New-World ABI, **glibc >= 2.38**, LSX

Owner hardware is not confirmed here. This recipe cannot close S06.

## Build 43.6.0 (not yet published by darkyzhou)

darkyzhou tags stop at `v43.4.1`. `scripts/env.sh` currently pins
`ELECTRON_VERSION=43.4.1` and `ELECTRON_BRANCH=v43.4.1-loong64`.
A 43.6.0 loong64 zip requires retargeting those patches onto official
Electron 43.6.0 and producing new hashed bytes.

1. On the Loong64 host, clone `https://github.com/darkyzhou/electron-loong64`
   (MIT) and review `scripts/env.sh`.
2. Launch `ghcr.io/darkyzhou/electron-buildtools:crimson-node-24`.
3. Set:

   ```
   ELECTRON_REPO=https://github.com/darkyzhou/electron.git
   ELECTRON_VERSION=43.6.0
   ELECTRON_BRANCH=<v43.6.0-loong64 or equivalent retarget of v43.4.1-loong64>
   ```

   Chromium patches come from the AOSC train documented by darkyzhou
   (`AOSC-Dev/chromium-loongarch64`), applied with `scripts/apply.sh` /
   `scripts/export.sh` if 43.6.0 needs a patch refresh.
4. `./scripts/update.sh` then `./scripts/sync.sh` (long).
5. Launch `ghcr.io/darkyzhou/electron-builder:crimson-llvm-23-rustc-196`.
6. `./scripts/binaries.sh`, `./scripts/rollup.sh`, `./scripts/build.sh`,
   `./scripts/package.sh`.
7. Hash the resulting `electron-v43.6.0-linux-loong64.zip`. Record URL,
   SHA-256, license, and glibc/LSX notes before any contract pin.

Until those bytes exist, 43.4.1 remains bootstrap-only.

## 中文

43.6.0 无官方 loong64 预编译。用 darkyzhou 的 Electron 43 / Chromium 150
构建镜像在龙芯新世界主机源码重建，43.4.1 只作引导，不得封入四端合同。
Node 不得改用 GitHub `loong64/node` 重建包。本配方不是原生 UOS PASS。
