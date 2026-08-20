# ADR 0012 — Feishu adapter auth（历史，已修订）

- 状态：SUPERSEDED_BY_ADR_0021
- 原日期：2026-08-15
- 取代日期：2026-08-16

旧决定把 App 配置 + OAuth Device Flow 当基础 bot path。现场核对确认 Device Flow 仍需 App ID/App Secret，且基础 bot 收发不需要 user OAuth。

alpha.3 改为企业自建 App ID/App Secret + official Node SDK Client/WSClient/EventDispatcher + long connection + `im.message.receive_v1`。App Secret 进 official credentials-local；当时不显示 QR，不引入 OpenClaw runtime。该“不显示 QR”条款已被 D-048 取代：当前默认是官方 `app/registration` 一键扫码，用户 Device Flow 仍禁止。
