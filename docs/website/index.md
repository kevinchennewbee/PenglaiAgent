# 蓬莱 0.4 官网源说明

0.4.0 的正式双语静态官网维护在仓库的 `gh-pages` 分支，包含中文根页面、英文 `/en/` 页面、真实产品截图与响应式样式。本文件只保留仓库内的来源说明，避免 `main` 与 `gh-pages` 出现两份会漂移的首页实现。

网站叙事遵循 0.4.0 产品边界：

- 一个 TypeScript Host 核心与一个 Pi 执行路径；
- 项目锚定是目录/权限边界，不是第二种能力模式；
- Tauri Desktop、CLI、飞书、微信连接同一份本地事实；
- 保留 SenseVoice ASR、MOSS-TTS-Nano 与 Owner opt-in 主动陪伴；
- 可核验的 Project / Task / Run / Evidence、审批、预算与 checkpoint；
- 证据产物的 Host 围栏应用内只读文本预览，以及显式触发、明确排除产品状态的脱敏诊断导出；
- 0.3.x Python 产品线保留在 `v0.3.6`，0.4 通过 dry-run/备份/rollback 手工迁移。

发布网站时只推送 `gh-pages` 分支；发布应用与源码时只推送 `main`/release 分支。两条分支都必须由 Owner 单独确认。
