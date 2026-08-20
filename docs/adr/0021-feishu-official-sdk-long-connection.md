# ADR 0021 — Feishu official SDK long connection

- 状态：ACCEPTED
- 日期：2026-08-16

## Decision

- pin `@larksuiteoapi/node-sdk@1.73.0` / official commit `f54b49f3566c52b54c598194b7ed3015e3e24224`。
- basic bot auth 是企业自建 App ID/App Secret；R2 UI 提供 bot/scopes/long connection/event/version publish 中文向导。
- receive 使用 WSClient + EventDispatcher + `im.message.receive_v1`；send/reply 使用 Client。
- event handler 3 秒内 durable enqueue/return，模型异步执行；0.5.0 为授权私聊 text+voice（入站 audio resource 本地 ASR，出站 official Opus `msg_type=audio`）。

**R3F 范围修订**：基础连接路径仍不是 OAuth Device Flow；群聊/图片/普通文件/视频/卡片仍在进模型前拒绝。
- Device Flow/QR 不在基础路径；不引入 openclaw-lark/OpenClaw runtime。
- App Secret 经 ADR 0018 credentials seam。
