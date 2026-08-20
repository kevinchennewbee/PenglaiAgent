# ADR 0006 — R2 DSH pin and composition

- 状态：ACCEPTED / AMENDED 2026-08-16
- 日期：2026-08-15

## Decision

R2 精确 pin `@deepseek-ai/dsh@0.1.0-rc.6`，integrity `sha512-brpZfED7ieRa2PQ5tUxMhHrM1pb2CmKFVM/f6yMULBDMicahk+Z2OsHgTwTDnoiZm23Ftu9rQz0NN4pflaoJcg==`，official commit `47f943859bef60e4160492346772ded9b24f765a`。

Web/profile 保留 official DSH base/web/locale/theme/Models/Workspace/Session/tools/approvals/settings composition。第一方插件用 profile dependencies + id-targeted patch 插入，不覆盖 official credentials 行；credentials 保持 `@deepseek-ai/dsh-credentials-local`。

Penglai 产品 identity 优先走 title/locale/slots/client modules。缺失 branding seam 时只允许 exact-version UI-only overlay，target checksum/patch checksum/reverse patch/capability parity gate 完整。禁止 fork DSH 或修改 Agent/runtime/network packages。
