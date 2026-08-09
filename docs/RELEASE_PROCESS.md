# 蓬莱 0.4 桌面发布流程

本文描述 `host-release.yml` 的唯一稳定发布路径。修改这套文件不会自动发版；只有
Owner 为精确 commit 创建并推送受信任的 signed annotated `v0.4.x` tag 后，工作流
才会开始。分支和手工触发不能进入发布作业。

## 1. 三条信任链不要混写

| 机制 | 保护什么 | 当前事实 |
|---|---|---|
| Owner GPG release key | tag 对象与 tag target | 工作流导入仓库内受信公钥，要求 annotated tag、有效签名和 `tag target = GITHUB_SHA = checkout HEAD` |
| Tauri updater minisign key | updater bundle、DMG detached signature、`SHA256SUMS` | 私钥只允许出现在 Owner 密钥库和 GitHub Actions secret；客户端只内置公钥 |
| Apple Developer ID / Windows Authenticode | 操作系统发行者身份、Gatekeeper / SmartScreen 体验 | **尚未配置或验证**；不得把 minisign 写成 notarization、Developer ID 或 Authenticode |

`TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 都必须存在且非空。
发布脚本会拒绝无密码/无私钥构建。私钥正文、密码、Owner 本地密钥路径不得进入
仓库、日志、artifact、release notes 或 SBOM。

## 2. 版本和目标的单一契约

[`packages/desktop/updater/release-contract.json`](../packages/desktop/updater/release-contract.json)
是 0.4 发布版本、平台矩阵、稳定通道和 release notes 路径的机器可读契约。

发 tag 前运行：

```bash
node scripts/check-release-contract.mjs
```

该检查要求以下版本完全相等：release contract、Host/Protocol/Desktop package、
`package-lock.json` workspace、Tauri config、Cargo package 和 Cargo lock 根包。发布时
tag 还必须精确等于 `v<contract.version>`；不存在“0.4.1 壳 + 0.4.0 Host”式自动戳号
或静默容错。

固定平台矩阵：

| updater key | runner | Rust/runtime target |
|---|---|---|
| `darwin-aarch64` | `macos-15` / `ARM64` | `aarch64-apple-darwin` |
| `darwin-x86_64` | `macos-15-intel` / `X64` | `x86_64-apple-darwin` |
| `windows-x86_64` | `windows-latest` / `X64` | `x86_64-pc-windows-msvc` |

每个 matrix job 都比较 GitHub runner OS/arch、Rust target、runtime manifest target 和
版本；不允许跨架构复用另一个 job 的 Host runtime。

## 3. 发版前 Owner 操作

1. 更新 release contract 版本，并同步所有被契约检查覆盖的版本面。
2. 更新 Owner 审核的 release notes（contract 的 `releaseNotes` 路径）。
3. 本地通过定向测试和完整发布门禁；确认工作树中没有 secret、owner data、日志或
   本地产物。
4. 在 GitHub 配置名为 `release` 的 protected environment，并要求 Owner approval。
   仓库文件只能引用该 environment，无法证明网页侧保护规则已经开启。
5. 确认 updater 私钥/密码 secrets 与客户端内置公钥是同一密钥对。
6. 对批准的精确 commit 创建 signed annotated tag；轻量 tag、未签名 tag、预发布
   semver（如 `v0.4.1-rc.1`）都会失败。

示意命令（不要由自动化代 Owner 执行）：

```bash
git tag -s v0.4.0 -m "Penglai 0.4.0"
git verify-tag v0.4.0
git push <public-remote> v0.4.0
```

## 4. CI 发布顺序

1. `validate`：验证严格 tag、受信 GPG fingerprint、签名、tag target 和版本契约；
   由契约输出三平台 matrix。
2. `runtime`：在 Linux x64 构建 self-contained Host runtime，按 exact version/target
   验 manifest、完整文件集、hash、boot handshake 和 doctor，再打 tar/zip。
3. `desktop`：每个平台自己重建 bundled runtime；Tauri 产生 updater bundle 签名；
   macOS DMG 另产 detached minisign（它不是 Apple code signing）。
4. `release`：生成不可变 `v0.4.x` asset URL 的 `latest.json`、从 npm/Cargo lock 与
   pinned bundled Node 生成 CycloneDX SBOM、第三方 notice；生成并 minisign
   `SHA256SUMS`。
5. `verify-release-assets.mjs` 要求精确资产集合，真实验证每个 minisign、manifest
   平台集合、SBOM 结构和全部 SHA-256。任何额外、缺失、空文件或 symlink 都失败。
6. 只创建 **draft Release**；再从 GitHub draft 下载全部资产并重新执行相同验证。
7. 回读通过后才 publish/mark latest；随后只把已经验证的 `latest.json` 推进固定
   `desktop-v0.4` metadata prerelease。

工作流拒绝覆盖已存在的版本 Release。失败留下 draft 时，Owner 先检查失败证据，再
手工决定是否删除 draft 后重跑；自动化不会 clobber 一个已有的版本发布。

## 5. 独立稳定更新通道

0.4 Desktop 只读取：

```text
https://github.com/kevinchennewbee/PenglaiAgent/releases/download/desktop-v0.4/latest.json
```

Updater metadata 与资产 URL 都只接受 canonical GitHub release 路径；不使用第三方
metadata/proxy fallback。`latest.json` 内每个平台 URL 必须指向不可变
`releases/download/v0.4.x/<asset>`，禁止 `releases/latest`。因此后续 0.3 release
是否被 GitHub 标为 latest，都不能把 0.4 客户端引向 0.3 manifest。

0.3 → 0.4 不走自动 updater bridge。用户必须手工下载安装 0.4，再按迁移指南先 dry
run 和备份。

## 6. 精确发布资产

以 0.4.0 为例，版本 Release 必须正好包含：

```text
Penglai_0.4.0_macos_aarch64.dmg
Penglai_0.4.0_macos_aarch64.dmg.sig
Penglai_0.4.0_macos_aarch64.app.tar.gz
Penglai_0.4.0_macos_aarch64.app.tar.gz.sig
Penglai_0.4.0_macos_x64.dmg
Penglai_0.4.0_macos_x64.dmg.sig
Penglai_0.4.0_macos_x64.app.tar.gz
Penglai_0.4.0_macos_x64.app.tar.gz.sig
Penglai_0.4.0_windows_x64_setup.exe
Penglai_0.4.0_windows_x64_setup.exe.sig
penglai-host-runtime-0.4.0-linux-x64.tar.gz
penglai-host-runtime-0.4.0-linux-x64.zip
latest.json
SBOM.cdx.json
THIRD_PARTY_NOTICES.txt
SHA256SUMS
SHA256SUMS.sig
```

稳定 channel Release 必须只含 `latest.json`。它是 metadata 通道，不是安装包仓库。

## 7. 发布后必须补的真实验证

- macOS arm64、macOS Intel、Windows x64 分别手工下载安装并确认 Host version/target。
- 从上一 0.4.x 真实执行检查更新、下载、验签、数据库备份、安装重启和握手。
- 篡改 bundle/signature/manifest 时客户端必须 fail closed。
- 如未配置 Apple notarization / Authenticode，release notes 和网站继续明确首次启动
  可能出现 Gatekeeper / SmartScreen 警告。

在这些真机证据完成前，只能说“本地/CI 发布链门禁已实现”，不能说正式分发或更新
生命周期已经验收。
