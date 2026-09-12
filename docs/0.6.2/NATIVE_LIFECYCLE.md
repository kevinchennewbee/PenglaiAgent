# Penglai 0.6.2 native lifecycle

Status: release procedure; no result in this document is a PASS by itself.

## English

All three installers must come from the same clean `main` commit. The native
workflow builds only the exact asset names declared by `release-contract.json`.

Apple Silicon and Windows x64 each run two independent lifecycle paths:

1. Fresh install, first boot, onboarding recovery cases, restart, and default
   uninstall with owner data preserved.
2. Download the immutable 0.6.1 public installer pinned by
   `docs/0.6.2/UPGRADE_SOURCES.json`, boot it, seed bounded preservation
   fixtures, install 0.6.2 over it, boot rc.2, and verify the original and
   migrated settings/session bytes, plugin desired state, and Memory data.
   Default uninstall must remove the application and preserve those same bytes.

The UOS job builds one complete `loongarch64` Debian package. It verifies the
old-world UOS 20 ABI, glibc 2.28 ceiling, embedded Node and Electron, exact DSH
rc.2 identity and runtime manifest, all first-party plugin packages, Office,
Memory, Mnemon, native add-ons, dependency metadata, and absence of foreign
architecture binaries. This is package and ABI evidence only.

Native UOS installation, startup, file-picker, sleep/resume, and functional UI
checks are `OWNER_POST_RELEASE`. The Owner will test the immutable public `.deb`
on the UOS machine. No pre-publication result may claim those checks passed.

The two-hour installed soak is `OWNER_EXCLUDED`.

## 中文

三个安装包必须来自同一个干净的 `main` 提交，并严格使用
`release-contract.json` 规定的文件名。

Apple 芯片 Mac 和 Windows x64 都要分别完成全新安装链路与 0.6.1 到 0.6.2
升级链路。升级使用 `docs/0.6.2/UPGRADE_SOURCES.json` 固定的公开 0.6.1 字节，
并逐项验证原始及迁移后的 DSH 设置、会话、插件启用状态与记忆数据。默认卸载只移除
应用，保留这些用户数据。

UOS 工作流生成一个完整 `loongarch64` Debian 安装包，检查 UOS 20 old-world ABI、
glibc 2.28 上限、内置 Node/Electron、DSH rc.2、全部第一方插件、办公、记忆、
Mnemon、本地扩展、依赖声明和跨架构污染。这里得到的是包与 ABI 证据，不是真机 PASS。
UOS 真机安装、启动、文件选择器、休眠恢复和功能界面由 Owner 在公开发布后测试，
保持 `OWNER_POST_RELEASE`。两小时安装版测试为 `OWNER_EXCLUDED`。
