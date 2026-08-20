# ADR 0018 — Official credentials-local and legacy Keychain migration

- 状态：ACCEPTED
- 日期：2026-08-16

## Context

Owner 已在真实 app 中用 official Models + `dsh-credentials-local` 完成 DeepSeek 对话，并明确不接受多余 Keychain 产品路径。微信 token 与飞书 App Secret 也需要统一 secret seam。

## Decision

- API key、Weixin token、Feishu App Secret 均经 official `credentials.set/describe/resolve/unset`，provider 为 app-private `.credentials.yaml`。
- renderer 只见 descriptor；目录 0700、文件 0600、atomic write；backup/log/DB/evidence 不复制 value。
- 同 UID 本地进程可读取 YAML 是诚实接受的 local-candidate boundary。
- 旧 Keychain override/item 只检测并显式迁移或重新录入；新 descriptor/真实 probe 成功后，用户另行选择是否精确删除旧 item。
- default profile/catalog/package 不含 credentials-keychain；MemoryVault/env/SQLite/Keychain 不是 fallback。

## Consequences

跨平台路径更接近 official DSH，减少 second provider/broker/权限弹窗；安全文案必须说明同 UID 边界。
