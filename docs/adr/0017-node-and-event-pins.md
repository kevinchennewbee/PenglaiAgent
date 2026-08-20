# ADR 0017 — Node pin and official DSH event contract

- 状态：ACCEPTED / AMENDED 2026-08-16
- 日期：2026-08-15

## Decision

1. Embedded Node 本版保持已验证的 `22.22.2` 和固定官方 tarball SHA-256，除非 RC1 isolated closure/ABI probe 支持升级。
2. `ctx.agents.resume()` 返回 `AgentHandle { agent, dispose }`；bridge 必须按 exact official contract 管 lifecycle。
3. IM final 只采用 durable session event 中 exact turn 的 `assistant/message` + `turn/end` 组合；live partial/turn end 单独不构成外发证据。
4. production credentials 是 official credentials-local；test doubles 只在隔离 test profile 使用，不允许 MemoryVault/env fallback 泄漏到 product apply。
5. Electron/pnpm 当前 pins 保持 lockfile 事实；变更需 closure/ABI/installed regression。
