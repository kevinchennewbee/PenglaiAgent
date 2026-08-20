# ADR 0010 — Client plugin and slot strategy

- 状态：ACCEPTED
- 日期：2026-08-15

## Decision

- Plugin Center：host plugin + 通过 `settings.plugins.tab` / plugin item slot 的 client contribution。
- Onboarding：编排 Welcome/Privacy/Ready；Models/BYOK 使用官方 Models UI。
- IM：host plugin 提供 remote/health；settings 页通过 DSH settings slot 或 Penglai Center 内嵌面板。
- 主窗口永不 `loadFile` 自制聊天页。bootstrap/recovery 仅短暂存在。
- R2 不做 official Web overlay；缺 slot 时 Center/IM 通过 host remote + 最小 client module，不复制 DSH UI。
