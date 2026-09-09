# Loongson UnionTech UOS — 0.6.0 fourth target

0.5.11 `docs/0.5.11/UOS.md` and the 0.5.12 exclusion are **historical**.
They are not authority to exclude 0.6.0.

**Confirmed Owner client (2026-09-09, PM-read screenshot).** Only
compatibility facts belong here. Machine name, activation/install dates,
photograph, and licensing details are private and must not appear in
public artifacts.

| Fact | Value | Status |
| --- | --- | --- |
| OS | UnionTech desktop OS **version 20**, Professional **1070**, 64-bit | confirmed |
| Kernel | `4.19.0-loongson-3-desktop` | confirmed |
| CPU | Loongson-3A6000-HV @ 2.5 GHz | confirmed |
| RAM | 16 GB (end-user client) | confirmed |
| `dpkg --print-architecture` | not in the screenshot | **unmeasured** |
| glibc version | not in the screenshot | **unmeasured** |
| dynamic loader path | not in the screenshot | **unmeasured** |
| user namespaces / bwrap / Landlock syscalls | not in the screenshot | **unmeasured** |
| remote access credentials | not in the screenshot | not requested here |

Owner did **not** ask to upgrade this OS. V25 is not the client. A V25
new-world build is not this target and is not delivery.

Target key remains **`linux-loong64`**. UOS `.deb` `Architecture:` remains
**`loongarch64`**. Packager name: `Penglai_0.6.0_uos_loong64.deb`. F05
put that filename in `release-contract.json`. Native install/startup/
function remain `OWNER_POST_RELEASE`.

## ABI assessment (source-backed; loader still unmeasured)

[areweloongyet old/new worlds](https://areweloongyet.com/en/docs/old-and-new-worlds/)
classifies **UOS V20** and any kernel whose version **starts with 4.19**
as **old-world (ABI 1.0)**. New-world kernels start at 5.19. Typical
markers:

| World | `file` interpreter | `for GNU/Linux` |
| --- | --- | --- |
| Old-world | `/lib64/ld.so.1` | `4.15.0` |
| New-world | `/lib64/ld-linux-loongarch-lp64d.so.1` | `5.19.0` |

3A6000 firmware can boot either world. **CPU model does not establish
userspace ABI.** This host’s kernel prefix plus UOS 20 is the
authoritative classification until `file /bin/ls`, `ldd --version`, and
`dpkg --print-architecture` are read on the machine.

Typical old-world userland (same source, not measured here): glibc 2.28,
gcc 8.3. Do not invent those numbers as this host’s probe.

## Incompatible binaries (actual bytes / vendor docs)

These are evidence **against those binaries on this OS**, not proof that
no client can exist.

| Artifact | Why it will not run on this host |
| --- | --- |
| unofficial-builds `node-v22.23.2-linux-loong64.tar.gz` | Downloaded bytes SHA-256 `36d02422cc40211415b394b9e24d2d62c0a346405410a0cbdc13a11f97ec4cd1` (57692301). `file`: ELF LoongArch, interpreter **`/lib64/ld-linux-loongarch-lp64d.so.1`**, **for GNU/Linux 5.19.0**, GLIBC symbols through **2.38**. New-world. |
| same release `.tar.xz` | Published SHA-256 `050dc2e09…`. Local copy was truncated (11415552 / 30641168, `xz: Unexpected end of input`). Do not pin from that file. |
| `darkyzhou/electron-loong64` 43.4.1 zip | Vendor: glibc **≥ 2.38**, LSX, new-world only. |
| Official Electron 43.6.0 / nodejs.org 22.23.2 loong64 | HTTP 404. |

Mac/Windows stay on official Electron **43.6.0** and Node **22.23.2**.
0.6.0 may honestly disclose a **different maintained platform runtime**
on UOS 20. It must not silently require 43.6.0 on this ABI, and it must
not silently ship EOL Chromium without naming the CVE/Chromium gap.

## Viable runtime options (for PM)

Builder RAM/disk is **not** the 16 GB client requirement. No paid
build host is authorized by implication.

| Option | Runtime | Chromium train | Old-world evidence | Cost |
| --- | --- | --- | --- | --- |
| **A. Loongson Electron 22.3.27** | Vendor SHASUMS256 `4b46329143bdfb34c11c10c4163b8bd85a3ff4506dd117c8838e479019563a53`. Zip bytes were **not** downloaded as a product default. | Chromium ~108 (Electron 22) | electerm still builds `*-loong64-legacy` | **Rejected as default.** Official Electron 22 is EOL. Larger Chromium gap than 31.7.7. |
| **B. Loongson Electron 31.7.7** | Actual zip SHA-256 `e0c756ca8a66dde3bece6ad902f152f539365ce7442d6353871d7c54d1c0f47b` (151528692 bytes, zip test OK, 2026-09-09). `electron`: interpreter **`/lib64/ld.so.1`**, **for GNU/Linux 4.15.0**, GLIBC symbols through **2.28**, `Chrome/126.0.6478.234`. `chrome-sandbox` same old-world loader. LICENSE MIT Electron. `node_headers` Node **20.18.0** / `NODE_MODULE_VERSION` 125. Zip members dated 2025-02-06. ftp.loongnix.cn has no newer LoongArch Electron than 31.7.7. | Chromium 126 (Electron 31, official train EOL) | **Old-world ABI proven from actual bytes.** Not native UOS PASS. | Newest vendor old-world binary with ELF proof. Security maintenance after 2025-02-06 is **unproven**. Chromium 126 vs Mac/Windows 150 must be disclosed. Embedded Node is 20.18.0, not 22.23.2. |
| **C. Source-build Electron 43 / Chromium 150 for old-world** | No public old-world 43.x recipe | Chromium 150 | Chromium 150 needs modern LLVM/glibc; old-world baseline is gcc 8 / glibc 2.28 / kernel 4.19 | No public recipe. Builder class is tens of GB RAM and hundreds of GB disk — **not** the 16 GB client. Not authorized paid infra. |
| **D. OS upgrade to UOS V25 new-world** | Would unlock darkyzhou/unofficial-builds 43.x | Chromium 150 | V25 is new-world in public catalogs | Owner did **not** request this. Not a silent requirement. |

**Defensible payload runtime (not a security-equivalent pin):** **B**
is the newest Loongson vendor Electron whose zip bytes and ELF world
were actually read. Use it for the UOS `.deb` with an honest Chromium
126 vs 150 note. Do not silently ship 22.3.27. Do not copy electerm’s
app. Mac/Windows remain 43.6.0. libLoL is old-world-on-new-world and
does **not** run Electron 43 on UOS 20. There is no public old-world
43.x recipe.

**Owner gate (2026-09-09):** native install, startup, and functional
acceptance on this machine are **post-publication Owner testing**. They
are not pre-publication blockers. Do not request remote access. Label
`OWNER_POST_RELEASE`, never PASS. Pre-publication still requires the
actual `.deb` with ABI/packaging/closure checks.

## Sandbox (do not fake)

Linux Landlock is a kernel LSM from **5.13**
([kernel Landlock docs](https://docs.kernel.org/userspace-api/landlock.html)).
Kernel **4.19 cannot provide Landlock**. Do not assume the syscall exists.

Official DSH `0.1.5-alpha.1` `@deepseek-ai/dsh-sandbox-local` Linux chain
is **`bwrap` then `landlock`**. The structural bwrap path is the host
`bwrap` binary (`command -v bwrap`, typically `/usr/bin/bwrap` from
bubblewrap). Landlock is a kernel LSM from 5.13; kernel **4.19 cannot
provide it**, so the landlock-run rung must fail closed on this OS.
If bwrap probes usable (user namespaces / setuid helper), confine is
bwrap-only. If no runner probes usable, `confine()` fails
**`SANDBOX_UNAVAILABLE`**. Commands must **not** run unrestricted.
Penglai must not pass `--no-sandbox`, strip `chrome-sandbox`, bundle a
fake Landlock, or disable Office/Memory. Whether UOS 20 1070 actually
ships `/usr/bin/bwrap` and enables user namespaces is
**`OWNER_POST_RELEASE`**, not pre-publication native PASS.

Chromium `chrome-sandbox` (setuid helper) is a different layer from DSH
Landlock. Keep it in the `.deb`. SUID/namespace success is unmeasured.

## Packaging that proceeds without hardware

- XDG under `~/.local/share/Penglai/0.5` (generation `penglai-dsh-v0.5`).
- `releaseTarget("linux", "loong64"|"loongarch64")` → `linux-loong64`.
- `.deb` class: `/opt/Penglai`, `.desktop`, `Architecture: loongarch64`,
  Office+Memory required, `chrome-sandbox` kept. Payload ELF, when
  present, must be old-world (`/lib64/ld.so.1`), not new-world
  `ld-linux-loongarch-lp64d.so.1`.
- Host Node for this client is **not** unofficial-builds 22.23.2 (new-world).
  Loongson ftp `node-v22.16.0-linux-loong64.tar.gz` actual SHA-256
  `37166d30a92b7b913e8cbc4b0aebcef9a21de46820d902687ff3b718cb6c75b1`
  (59181692, gzip ok). `bin/node`: interpreter **`/lib64/ld.so.1`**,
  **for GNU/Linux 4.15.0**, GLIBC ≤2.28, LICENSE Node.js MIT. Old-world
  host/tooling candidate, **behind** product Node 22.23.2. Electron 31.7.7
  embeds Node **20.18.0** (`NODE_MODULE_VERSION` 125). Do not mix trains.
- `@deepseek-ai/node-addon-system@0.1.2` ships darwin-arm64/x64 and
  linux-x64/arm64 only. There is **no** linux-loong64 prebuild in the 272
  cohort. JSONL flock writes fail closed without a loong64 addon; that is
  a disclosed compatibility gap, not a reason to disable Memory.

Host `dpkg` / `bwrap` / Landlock syscall probes are Owner post-release
acceptance. QEMU is not native proof. Do not request remote access.

## 中文

0.6.0 第四客户端是统信桌面操作系统 **20** 专业版 **1070**、内核
`4.19.0-loongson-3-desktop`、处理器 Loongson-3A6000-HV 2.5 GHz、内存 16
GB。这不是 V25，也不是新世界。3A6000 不能单独证明用户态 ABI。UOS V20 与
4.19 内核按公开资料属于旧世界（`/lib64/ld.so.1`）。new-world 的
Electron 43 / unofficial-builds Node 22.23.2 已用实际字节证明不兼容。
不得要求用户升级系统，也不得用 V25 冒充交付。沙箱不得 `--no-sandbox`
或伪造 Landlock；4.19 没有 Landlock。办公与记忆保持必装。Loongson
Electron 31.7.7 已用实际 zip/ELF 证明为旧世界（`/lib64/ld.so.1`、
Chromium 126），不是 43.6.0 的安全等价。原生安装/启动/功能由 Owner
在正式发布后验收，标 `OWNER_POST_RELEASE`，不得标 PASS，也不得再索
远程登录。发布前仍须交出真实 `.deb`。
