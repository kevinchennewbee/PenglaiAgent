# Penglai 0.6.5 messaging delta

DSH `0.1.6-alpha.2` does not replace Penglai's IM control plane. Penglai keeps
one reviewed `@penglai/im` plugin and does not install the community dsh-im
runtime.

The plugin itself is bundled and active on a fresh profile. This does not
configure an account or start a channel. The channel behavior shipped in 0.6.3 is
retained; the WeChat transport contract verified for this version is recorded in
`docs/compatibility/WEIXIN_R2.md`. The retained channels are:

- Weixin, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, and Discord channel
  connections remain optional and default off.
- Weixin and Feishu inbound files enter the exact bound official Session as
  DSH file attachments.
- Missing or replaced Sessions keep a durable, user-actionable error instead
  of silently moving a message to another conversation.
- Bot aliases stay local display metadata.
- iMessage remains optional private text on macOS only, default off. It does
  not support images, files, or group chats and remains `LIVE_NOT_RUN`.
- WhatsApp, a second Office plugin, `/api/dsh-im/*`, and a second Host remain
  forbidden.

The upstream alpha.2 Session ownership and controller changes are adopted by
removing synchronous Session-log reads from production IM recovery and dedupe.
They do not change these routing or authorization boundaries.
