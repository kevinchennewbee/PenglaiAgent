# WeChat / iLink channel pins (R2)

Penglai's WeChat channel speaks Tencent's official **iLink bot API** directly.
It is an isolated rewrite of the request/response surface, not an OpenClaw
plugin, and it does not depend on any community runtime.

Everything on this page is an **external fact**, not a product preference. It is
recorded because the channel previously froze assumptions about Tencent's
behaviour into source code with nothing that would notice when they changed.

## Channel build pin

| item | pin | notes |
| --- | --- | --- |
| `@tencent-weixin/openclaw-weixin` | `2.4.9` | Tencent-published; `author: Tencent`, MIT |
| `ILINK_CHANNEL_VERSION` | `2.4.9` | announced to the server in `base_info.channel_version` |
| `ILINK_APP_CLIENT_VERSION` | `132105` | `0x00MMNNPP` = `buildClientVersion("2.4.9")` |

The channel build is announced on every request through `iLink-App-ClientVersion`
and `base_info.channel_version`, so it is a server-visible identity rather than a
cosmetic constant.

`2.4.6` (published 2026-06-22) was the previous pin. Tencent shipped `2.4.8`
(2026-09-01) and `2.4.9` (2026-09-17) from the same scope while Penglai stayed
put. Before moving the pin, the endpoint surface was compared between the two
builds and the live bot surface was probed with both client versions:

- the `ilink/bot/*` endpoint set is **identical** across `2.4.6` and `2.4.9`;
  the changes between them are messaging features Penglai does not use
  (`messaging/dispatch-options`, `partial-quote`, `quote-store`)
- `get_bot_qrcode` returns a usable QR under both `132102` and `132105`

## Endpoints in use

| endpoint | purpose |
| --- | --- |
| `POST ilink/bot/get_bot_qrcode?bot_type=3` | start a login QR |
| `GET ilink/bot/get_qrcode_status?qrcode=…` | poll that QR |
| `POST ilink/bot/getupdates` | inbound long poll |
| `POST ilink/bot/sendmessage` | outbound |
| `POST ilink/bot/getuploadurl` | CDN upload ticket for media/voice |
| `POST ilink/bot/getconfig` | typing ticket |
| `POST ilink/bot/sendtyping` | typing indicator |

Base `https://ilinkai.weixin.qq.com`, CDN `https://novac2c.cdn.weixin.qq.com/c2c`.
Redirect bases are restricted to `ALLOWED_REDIRECT_HOSTS`.

## Content type is advisory on this surface

**Tencent serves the whole iLink bot surface as `Content-Type:
application/octet-stream` while the body is the documented JSON envelope.**
Observed live 2026-09-19:

```
POST https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3
-> HTTP 200
   Content-Type: application/octet-stream
   {"qrcode":"3f743810db1b531e5e2d56964b418d0d",
    "qrcode_img_content":"https://liteapp.weixin.qq.com/q/…&bot_type=3",
    "ret":0}
```

The channel therefore does **not** gate on `Content-Type`. That gate
(`jsonMimeAllowed`) was added in 2026-08-24 and rejected healthy responses,
breaking WeChat for eight releases. The guards that remain are stronger than the
header check they replaced: the origin is a module constant plus a redirect
allowlist, the body is size- and time-bounded, and the parsed envelope is
validated by `readIlinkEnvelope`. See `ILINK_CONTENT_TYPE_IS_ADVISORY` in
`packages/channel-weixin/src/protocol.ts`.

A vendor that does declare `application/json` — every other channel's vendor —
must keep using `jsonMimeAllowed`.

## Response envelope

Failures carry a non-zero `ret` and an `err_msg`:

```
GET ilink/bot/get_bot_qrcode              -> {"err_msg":"missing bot_type","ret":1}
GET ilink/bot/get_bot_qrcode?bot_type=999 -> {"err_msg":"invalid bot_type","ret":2}
GET ilink/bot/get_qrcode_status?qrcode=…  -> {"ret":0,"status":"expired"}
```

`ret` is read **per endpoint**, never rejected centrally: `getuploadurl` reports a
retryable vendor code through it, and `packages/channel-weixin/src/cdn.ts` maps
that code to `AUTH_EXPIRED` / `DELIVERY_TRANSIENT` itself while surfacing only a
numeric diagnostic. Vendor `err_msg` text never becomes an error code or
user-facing copy.

## Enforcement

- `packages/channel-weixin/src/protocol.ts` holds every constant above.
- `pnpm verify:contracts` and `packages/channel-weixin/src/protocol.contract.test.ts`
  assert the closed QR status enum, the QR TTL, the poll timeout, and the
  `X-WECHAT-UIN` shape.
- `packages/channel-weixin/src/weixin.test.ts` carries the octet-stream
  regression pin (`R2I-WX-MIME`) and the vendor `ret` classification pin
  (`R2I-WX-RET`).
- The `weixin-ilink` drift probe replays the live QR request and fails when the
  body stops being a usable JSON envelope, so a future content-type or envelope
  change is detected without a user having to report it.
