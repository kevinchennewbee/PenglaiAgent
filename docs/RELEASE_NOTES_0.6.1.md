# Penglai 0.6.1 (source draft)

This is **not** a public download claim. Immutable public bytes remain
[`v0.6.0`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.0)
until GitHub Release `v0.6.1` exists. Apply public README/website download
tables only after those bytes exist.

Penglai 0.6.1 source uses official DeepSeek Harness `0.1.5-rc.1` (tag
`dsh-v0.1.5-rc.1`, commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`, 279-package
cohort). DSH remains the only agent core. Office and Memory stay required and
default-on. Optional plugins stay default-off.

## Intended changes

- Official DSH `0.1.5-rc.1` complete registry cohort. Fresh wizard consumes
  official `deepseek-flash` with text+image and in-history system-prompt
  metadata. Image-input edits keep unknown official model fields.
- First-party boot preserves a newer plugin only when a signed catalog record
  and installed identity match. Unverified overlays are isolated, not deleted.
- Session list follows rc.1: one list of all visible sessions; `nextCursor` is
  not a public list seam. Cold-session inspect recovery remains.
- Four packaged targets remain Apple Silicon, Intel Mac, Windows x64, and
  UnionTech UOS 20 LoongArch. UOS native install/startup/function for 0.6.1 is
  `OWNER_POST_RELEASE`: the Owner will test the published installer. The 0.6.0
  `OWNER_POST_RELEASE` record is not a 0.6.1 PASS.
- Official generic right-sidebar preview is plain text for DOCX and may report
  a non-text file. Structured Office inspect/preview and saved Office bytes
  remain authoritative.

## 中文

这不是公开下载声明。公开下载仍是不可变 [`v0.6.0`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.0)，直到 `v0.6.1` GitHub Release 字节存在。0.6.1 源码使用官方 DSH `0.1.5-rc.1`（279 包）。办公和记忆默认开启。UOS 真机安装/启动/功能为 `OWNER_POST_RELEASE`，由 Owner 在发布后测试安装包。官方通用侧栏对 DOCX 只提供纯文本预览。
