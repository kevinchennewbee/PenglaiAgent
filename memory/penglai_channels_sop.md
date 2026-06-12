# penglai_channels_sop — 用户想增删 IM 渠道时怎么办

触发：用户说"我想加个钉钉/QQ/Telegram/Discord/企业微信/飞书/微信"、"换个渠道聊"、
"QQ 怎么连不上"之类。**蓬莱有现成的渠道命令,不要现场推理教用户去开放平台手动建应用。**

## 一句话答案

| 用户想要 | 让用户在服务器终端跑 | 说明 |
|---|---|---|
| 加钉钉 | `penglai enable dingtalk` | 手机钉钉扫码,平台自动建机器人应用,免开网页 |
| 加 QQ | `penglai enable qq` | 手机 QQ 扫码绑定,自动建机器人;终端会逐步打印状态 |
| 加 Telegram | `penglai enable telegram` | 找 @BotFather 拿 bot token 贴进去 |
| 加 Discord | `penglai enable discord` | 开发者后台拿 bot token 贴进去 |
| 加企业微信 | `penglai enable wecom` | 管理后台建智能机器人,贴 Bot ID/Secret |
| 加飞书 / 微信 | `penglai setup` | 走向导(扫码建应用/扫码登录,含连接验证闭环),已配的步骤回车跳过 |
| 看渠道状态 | `penglai channels` | 凭证/依赖/运行/实测状态一览 |
| 停用某渠道 | `penglai disable <渠道>` | 凭证保留,enable 可复用 |
| 看渠道日志 | `penglai logs <渠道>` | 排障第一步 |

## 你(agent)能直接做的 vs 必须用户做的

- 你可以:跑 `penglai channels` 查状态、`penglai logs <ch>` 看日志、解释流程、排障。
- 必须用户做:**扫码**(二维码出在用户终端,你在 IM 里替代不了)、贴 token、给手机确认。
  所以正确姿势 = 把上表对应的一条命令发给用户,告诉他在服务器终端执行,有问题把输出贴回来。

## 关键事实(防止你想当然)

- 凭证由 enable 流程自动写入 mykey.py(钉钉/QQ 扫码自动取回,先备份 .bak),不要手工编辑。
- 每个渠道有白名单键(如 qq_allowed_users / tg_allowed_users):留空 = 对所有人开放,要提醒用户填。
- 服务名 = penglai-<渠道>(systemd),无 systemd 时是 nohup 进程。
- **语音条目前只有飞书和微信渠道支持**(其余渠道的上游前端不传语音,已在适配清单)。
- 钉钉/QQ/TG/Discord/企微标"待实测":启动成功只代表进程在跑,要用户真发消息验证。
