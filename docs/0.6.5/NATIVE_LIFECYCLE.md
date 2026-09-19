# Penglai 0.6.5 native lifecycle

Status: active 0.6.5 release procedure. Native results become PASS only when
the exact clean `main` SHA produces matching installed/package evidence.

## English

All three installers must come from the same clean `main` commit. The native
workflow builds only the exact asset names declared by `release-contract.json`.

Apple Silicon and Windows x64 must prove fresh install, first boot, onboarding
recovery cases, restart, and default uninstall with owner data preserved.

The 0.6.3 to 0.6.5 installed-upgrade journey is `OWNER_EXCLUDED` for this
release. `UPGRADE_SOURCES.json` retains immutable historical pins for updater
identity and future historical verification, but the 0.6.5 native workflow must
not download, execute, or report that upgrade journey as PASS.

The UOS job builds one complete `loongarch64` Debian package. It verifies the
old-world UOS 20 ABI, glibc 2.28 ceiling, embedded Node and Electron, exact DSH
alpha.2 identity and runtime manifest, all in-scope first-party plugin packages,
Memory, Mnemon, native add-ons, dependency metadata, explicit absence of
LibreOffice/Office/PDF/Budget/Companion, and absence of foreign
architecture binaries. This is package and ABI evidence only.

Native UOS installation, startup, file-picker, sleep/resume, and functional UI
checks are `OWNER_POST_RELEASE`. The Owner will test the immutable public `.deb`
on the UOS machine. No pre-publication result may claim those checks passed.
The two-hour installed soak is also `OWNER_EXCLUDED`.

## 中文

三个安装包必须来自同一个干净的 `main` 提交，并严格使用
`release-contract.json` 规定的文件名。

Apple 芯片 Mac 和 Windows x64 都必须完成全新安装、首次启动、引导恢复、重启和
默认卸载，并证明 Owner 数据保留。0.6.3 到 0.6.5 的安装升级在本版明确为
`OWNER_EXCLUDED`；`UPGRADE_SOURCES.json` 仅保留不可变历史 pin 与更新序列依据，
native workflow 不下载、不执行，也不得宣称升级 PASS。

UOS 工作流生成一个完整 `loongarch64` Debian 安装包，检查 UOS 20 old-world ABI、
glibc 2.28 上限、内置 Node/Electron、DSH alpha.2、范围内第一方插件、记忆、
Mnemon、本地扩展、依赖声明，以及 LibreOffice/办公/PDF/预算/主动陪伴明确缺席和
跨架构污染。这里得到的是包与 ABI 证据，不是真机 PASS。
UOS 真机安装、启动、文件选择器、休眠恢复和功能界面由 Owner 在公开发布后测试，
保持 `OWNER_POST_RELEASE`。旧版安装升级与两小时安装版测试均为 `OWNER_EXCLUDED`。
