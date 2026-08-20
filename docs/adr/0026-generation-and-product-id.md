# ADR 0026 — Product identity and 0.5 generation root

- 状态：ACCEPTED
- 日期：2026-08-16
- RC：RC1

## Context

0.4.1 是 Tauri Host 产品线，数据与凭据不在 0.5 迁移范围内。用户已确认 0.4.1 不能升级到 0.5.0 没关系。需要既保持用户可见名称 “蓬莱 / Penglai”，又避免覆盖旧 data 或出现无法辨认的双产品。

## Decision

- 用户可见产品名：Penglai / 蓬莱。
- 0.5 generation id：`penglai-dsh-v0.5`。
- macOS userData：`~/Library/Application Support/Penglai/0.5`
- Windows userData：`%LOCALAPPDATA%\Penglai\0.5`
- DSH_HOME：`<userData>/dsh-home`
- macOS bundle id 继续可用 `com.penglai.agent` 作为用户可见连续性，但 0.5 数据根必须与 0.4.1 隔离。
- Windows AppId/UpgradeCode 在 NSIS 合同中单独固定，且不得指向 0.4 install root。
- 0.4.1 legacy detector 只读存在/版本/大致大小，不打开旧 DB/credential，不迁移、不删除。

## Consequences

- Electron `userData` 子目录从 `penglai-v0.2.0-alpha.3` 改为 `0.5`。
- 卸载器永远不得把 0.4.1 路径或用户 Workspace 写入 deletion plan。
- 未知更老 generation fail closed，不猜测兼容。
