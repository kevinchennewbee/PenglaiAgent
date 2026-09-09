# Loongson UnionTech UOS — 0.6.0 fourth target

0.5.11 `docs/0.5.11/UOS.md` and the 0.5.12 exclusion are **historical**.
They are not authority to exclude 0.6.0. This file is the current
critical path, not a parking lot.

Target key: **`linux-loong64`**. Installer name (after F05):
`Penglai_0.6.0_uos_loong64.deb`.

## ABI

Loongson 3A6000/3B6000-class desktop is LoongArch64 **new-world** (ABI 2.0).
Penglai target key: **`linux-loong64`**. UOS `.deb` `Architecture:` is
**`loongarch64`** (same binary, packaging metadata). Debian community
packages use `loong64`. There is no `loongarch64el`.

**UOS V20 is old-world** (kernel 4.19, `/lib64/ld.so.1`) and cannot run
glibc >= 2.38 Electron 43. 0.6.0 UOS is **Desktop V25 LoongArch64 (2500)
new-world only**. Discriminator on hardware: `file /bin/ls` and
`dpkg --print-architecture`.

## Authentic runtimes (not official Electron/Node loong64 prebuilts)

Official Electron 43.6.0 and nodejs.org 22.23.2 have **no** loong64
assets. Absence of official prebuilts is not permission to abandon the
target.

| Input | Pin in progress | Provenance |
| --- | --- | --- |
| Node 22.23.2 linux-loong64 | `https://unofficial-builds.nodejs.org/download/release/v22.23.2/node-v22.23.2-linux-loong64.tar.gz` SHA-256 `36d02422cc40211415b394b9e24d2d62c0a346405410a0cbdc13a11f97ec4cd1` | Node.js unofficial-builds project; same version as the three official targets |
| Electron 43.6.0 linux-loong64 | source-build official Electron 43.6.0 with `darkyzhou/electron-loong64` / AOSC patches (`ghcr.io/darkyzhou/electron-builder:crimson-llvm-23-rustc-196`) | Same upstream identity as Mac/Windows. Official GitHub has no loong64 zip. |
| Electron 43.4.1 linux-loong64 (bootstrap only) | `https://github.com/darkyzhou/electron-loong64/releases/download/v43.4.1/electron-v43.4.1-linux-loong64.zip` SHA-256 `58c900f8c38d42290fb4bdc0dc3df90a5977efd96aa39f06ce4bf4345a2fc4e9` | MIT, glibc >= 2.38, LSX. Two patch trains behind 43.6.0. Do not seal four targets on 43.4.1. |

This is a **named, hashed, licensed architecture build**, not a second
agent core. DSH remains the official npm JS cohort. Sealed 0.6.0 UOS
Electron should be 43.6.0 loong64 bytes; 43.4.1 is bootstrap while
hardware is pending.

Do not ship linux-x64 UOS as a substitute for Loongson.

## Product work that proceeds without hardware

- XDG layout under `~/.local/share/Penglai/0.5` (generation id stays
  `penglai-dsh-v0.5` until an explicit Home bump; do not invent a parallel
  data root).
- `releaseTarget("linux", "loong64")` → `linux-loong64`.
- `.deb` + `.desktop` + UOS control fields, process tree, 0700/0600
  secrets or libsecret, updater fourth filename, uninstall categories.
- Office and Memory remain required-builtin. Sandbox mapping
  (Landlock/seccomp) is designed, not stripped.

## Still required from Owner / PM (already requested)

Precise inputs; independent work continues:

1. Loongson CPU model and New-World confirmation (LSX, glibc >= 2.38).
2. UnionTech UOS desktop version and `dpkg --print-architecture`.
3. Existing remote access alias and whether install/sudo is available.
4. Whether that host can source-build Electron 43.6.0 (RAM/disk class
   above) or must consume the 43.4.1 community zip.

Do not ask the user to diagnose a TCP port.

## Native gate

Actual UOS functional and lifecycle evidence on Loongson hardware is
required before claiming the fourth target delivered. QEMU on Mac,
cross-build staging, and a linux-x64 VM are not native Loongson PASS.

## 中文

0.6.0 第四目标是新世界龙芯 + 统信 UOS（`linux-loong64`）。官方 Electron/
Node 无 loong64 预编译不是放弃理由：Node 使用 unofficial-builds 同源
22.23.2，Electron 使用已审查 MIT 社区 43.4.1，并写明与 43.6.0 的差异。
可先做 Linux 包装与布局；原生 PASS 必须等匹配硬件。不得用 amd64 UOS 冒充
龙芯，也不得为出窗口而关掉办公/记忆或沙箱。
