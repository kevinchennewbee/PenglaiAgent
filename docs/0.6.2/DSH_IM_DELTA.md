# Penglai 0.6.2 messaging delta

DSH `0.1.5-rc.2` does not replace Penglai's IM control plane. Penglai keeps
one reviewed `@penglai/im` plugin and does not install the community dsh-im
runtime.

The 0.6.1 messaging behavior is retained and revalidated against rc.2:

- Weixin, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, and Discord remain
  optional and default off.
- Weixin and Feishu inbound files enter the exact bound official Session as
  DSH file attachments.
- Missing or replaced Sessions keep a durable, user-actionable error instead
  of silently moving a message to another conversation.
- Bot aliases stay local display metadata.
- iMessage remains optional private text on macOS only, default off. It does
  not support images, files, or group chats and remains `LIVE_NOT_RUN`.
- WhatsApp, a second Office plugin, `/api/dsh-im/*`, and a second Host remain
  forbidden.

The upstream rc.2 change adopted by Penglai is the official feedback and file
presentation surface. It does not change these routing or authorization
boundaries.
