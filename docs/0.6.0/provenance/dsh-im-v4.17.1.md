# dsh-im v4.17.1 supply-chain and port record

This is the Penglai 0.6.0 DSH-IM review baseline. Penglai does not install
DSH-IM as another Agent core and does not copy generated `lib/`, `bin/`,
`cordis.patch.yml`, WhatsApp, or Office-as-IM.

4.17.1's product delta versus 4.17.0 is the Connection public `/api` Fetch
management adapter for unmodified DSH `0.1.5-alpha.1`. After inspecting
`@penglai/im`, that carrier is already present. This record re-pins the
rewrite-source identity and states the non-port. It does not add a second
IM core.

## Identity

| Field | Value |
|---|---|
| Upstream | `https://github.com/xmanrui/dsh-im` |
| npm | `@xmanrui/dsh-im@4.17.1` |
| Version | `v4.17.1` |
| Annotated tag object | `51fb6bb03d86045cbe55e5fde3e55308f0f3643e` |
| Peeled commit | `464c0a91762ebd0befc2d179f036eaae4864fb0e` |
| Tag signed | no; `verification.verified=false`, `reason=unsigned` |
| Archive URL | `https://codeload.github.com/xmanrui/dsh-im/tar.gz/464c0a91762ebd0befc2d179f036eaae4864fb0e` |
| Archive SHA-256 | `2bb02ea00d3367c1d93681f1e64bf030813f059f0cd62ef9c523dad1ab3b984b` |
| Archive bytes | `12029018` |
| License | MIT, copyright 2026 xmanrui |
| License SHA-256 | `2e1c6321c5df1830b8758dd6d1cc1c70c41f561129581f1986b408255f67d588` (1064 bytes; unchanged from v3.0.5) |
| npm tarball SHA-256 | `607a775b29e1355ab3f2953e45fb217f1102685202e0eca9f121d59abb138fec` (supplemental; not the pin) |
| npm integrity | `sha512-hAn0zvPl6+EsA5ZmGSECQtIzAY9IxePOfOCI3d5cxTP1dpzPrpYBW0TlLRv9fI+0A5hyVSEqqCkSKW8KL1cF2Q==` |
| Fetched | `2026-09-09` |
| Use | selective rewrite into `@penglai/im`; do not install runtime; do not copy `lib/`, `bin/`, or `cordis.patch.yml` |
| Supersedes | v3.0.5 / `64587b3b6162fa34f1c3ddb335a254d4154c9175` |

Official DSH for this Penglai version is `0.1.5-alpha.1` /
`dsh-v0.1.5-alpha.1` / `5dda764ed3aa172535a7967b06ff95d9cbfe536a`.

## Connection `/api` — already equivalent; not reimplemented

Upstream 4.17.1 registers management RPC with
`ctx.connection.fetch.register({ path: `/api/${endpoint}` })` and the
browser calls `connection.rpc.call('/api', endpoint, { method, payload })`.
That is required for a community plugin that is **not** a Typert Remote,
because DSH 0.1.5-alpha.1 Typert Gateway already owns the sole `/api`
interceptor.

Penglai IM is a first-party Typert Remote on that same public carrier:

| Layer | File | Evidence |
|---|---|---|
| Host Remote | `packages/im/src/remote.ts` | `PenglaiImRemote extends TypertRemoteService` constructed as `super(ctx, "penglaiIm")`. Methods are `@PenglaiRemote`. |
| Host mount | `packages/im/src/index.ts` | `if (isPenglaiRemoteContext(ctx)) new PenglaiImRemote(ctx, host)`. |
| Gateway claim | DSH `@deepseek-ai/dsh-api-gateway` | `connection.rpc.intercept('/api', endpoint => this.claimsEndpoint(endpoint), ...)`. Source-mode claims are `penglaiIm/${method}` (exactly two segments). |
| Client preferred | `packages/im/src/dsh-client.js` | `ctx.remote.$mount(REMOTE)` then `remote.penglaiIm[method](...)`. |
| Client fallback | `packages/im/src/dsh-client.js` `imCall` | `connection.rpc.call("/api", "penglaiIm/" + method, { args: args ? { input: args } : {} })`. That POSTs to `/api/penglaiIm/<method>` with the Connection unary envelope Gateway already decodes. |
| Settings inject | `packages/im/package.json` `dsh.client.inject` | `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-client-connection`. |

The eight product channels (Weixin, Feishu, DingTalk, WeCom, QQ, Slack,
Telegram, Discord) share this one `penglaiIm` Remote. They do not need
per-channel `dsh-im/weixin`-style Fetch routes. Adding
`connection.fetch.register` for those routes would be a second IM control
plane on top of `PenglaiImHost`.

4.17.1 CHANGELOG has no channel protocol change versus 4.17.0. Penglai
already rewrote the eight product transports under Vault + Owner Broker
(Weixin iLink including exact `ilinkai.wechat.com`, official Feishu Lark
SDK, DingTalk stream 2.1.5, WeCom WS, QQ MIT QR rewrite, Slack Socket
Mode, Telegram long-poll, Discord DM-only Gateway). No additional
4.17.1 protocol/UX port is required for unmodified DSH `0.1.5-alpha.1`.

## Explicitly not ported

| Upstream | Why |
|---|---|
| `@xmanrui/dsh-im` runtime / Plugin Center catalog | Second Messaging plugin and second conversation overlay |
| `lib/**` | Generated; contains Baileys / sharp / Lark bundle |
| `bin/**` | Second CLI that runs `dsh plugin add` |
| `cordis.patch.yml` | Second DSH overlay |
| `plugin-src/management-rpc.mjs` as Penglai control plane | Would duplicate Typert remotes with nested `{ method, payload }` Fetch handlers |
| `plugin-src/host/harness-*.mjs`, `modern-harness-api.mjs` | Second session/command host |
| `plugin-src/host/update-*.mjs` | Mutates the DSH profile outside Plugin Center |
| `plugin-src/host/delivery-http.mjs`, `POST /api/dsh-im/delivery/messages`, `ctx.dshIm` | Second public Host API; Companion/IM outbox is Penglai-owned |
| `src/channels/whatsapp/**`, Baileys, libsignal | D-062; permanently rejected |
| `src/channels/office/**` | Penglai Office is required `@penglai/office`, not an IM adapter |
| `src/channels/wecom-app/**` | Ninth/tenth experimental channel; extra HTTP listener; not a Penglai product channel |
| Feishu live process cards / DingTalk AI Card stream / DOM session logos | 4.16–4.17.0 UX; Penglai outbox delivers the durable official final only |
| `dingtalk-stream` 2.1.4 | Penglai stays on 2.1.5 |
| `@tencent-connect/qqbot-connector` | UNLICENSED |

Preserve the MIT notice on any later adapted source file. Prefer rewrite.
Historical 0.5.7 pin and post-pin review remain at
`docs/0.5.7/provenance/dsh-im-v3.0.5.md` and `dsh-im-v3.0.6.md`.
