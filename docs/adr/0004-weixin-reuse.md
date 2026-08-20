# ADR 0004 — 腾讯微信复用边界

> HISTORICAL R1 INPUT：R2 必须对 Tencent current commit 重做 diff、许可与完整 lifecycle 探针。

- 状态：ACCEPTED
- 日期：2026-08-15
- 取代：D-027 PROBE

## Context

Tencent/openclaw-weixin 2.4.6 MIT，但 peer 依赖完整 OpenClaw。不能把 OpenClaw plugin 装进 DSH。

## Evidence

- LICENSE MIT，Copyright (C) 2026 Tencent
- `index.ts` 仅 `registerChannel` OpenClaw SDK
- 协议在 `src/api`、`src/auth/login-qr.ts`：ilinkai.weixin.qq.com、get_bot_qrcode、getupdates、sendmessage
- 媒体/CDN/OpenClaw slash 与 R1 范围冲突

## Decision

**隔离复用 / 重写最小协议层。** `@penglai/channel-weixin` 自研 HTTP 客户端与 QR 状态机，语义对齐官方公开协议。不添加 `openclaw` 依赖。NOTICE 保留腾讯版权。

可行性：私聊文本 + QR/device auth **可行**，不需要第二 Agent runtime。

失败才会 BLOCKED：闭源-only 或必须跑 OpenClaw Agent。当前未触发。

## Security impact

凭据进 OS 安全存储。验证码停下等人。群聊/媒体拒绝。
