# ADR 0025 — 0.5 signed assisted update

- 状态：ACCEPTED
- 日期：2026-08-16
- RC：RC1 / 由 RC11 实施

## Context

Electron `autoUpdater` 在 macOS 依赖 Squirrel.Mac，且官方要求已签名 app。当前 community-verified 候选只有 ad-hoc seal，没有稳定 Developer ID identity，也未证明 quarantine/替换/回滚。用户已接受 0.4.1 同级信任边界，并明确 0.4.1 → 0.5.0 不做自动升级。

## Decision

从 0.5.0 起只实现 **signed assisted upgrade**：

1. 只读 canonical HTTPS `desktop-v0.5` manifest（不可变 asset URL，禁止 `releases/latest` 与 HTTP）。
2. main process 校验 manifest 独立签名、payload 独立签名、SHA-256、size、platform/arch、SemVer。
3. anti-rollback / same-version replay ledger。
4. UI 显示版本、大小、trust tier，用户确认后打开已验 DMG/Setup。
5. 安装前 drain DSH/IM，写 journal；新版本 post-verify 后 commit，失败 rollback。

签名算法：Owner 持有的独立 minisign/Ed25519。`release-contract.json` 嵌入 public key id 与 hex。RC1 先钉 fixture public key，只用于负向/集成测试；final key 仅在成为唯一剩余门时由 Owner 注入。

明确不实现：

- macOS silent auto-update
- renderer 自定义 feed/URL
- 只用 HTTPS 或只用 SHA-256 而无独立签名
- 0.4.1 updater bridge

## Consequences

- UI/README/About 必须写 “辅助升级 / assisted upgrade”，不得写静默自动更新。
- RC11 用 loopback fixture server + ephemeral key 覆盖 valid/tamper/wrong-key/rollback/cancel/crash。
- fixture private key 不进 git/bundle/evidence。
