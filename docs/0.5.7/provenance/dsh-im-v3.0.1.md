# dsh-im v3.0.1 supply-chain record

This is a **historical** 0.5.7 DSH-IM provenance baseline, superseded by
`dsh-im-v3.0.2.md`. Penglai does **not** install this package as a second
Agent core or copy generated `lib/`.

Selected channel authentication, transport, typing, reaction, markdown, and
structured failure ideas may be rewritten into `@penglai/im`.

## Identity

| Field | Value |
|---|---|
| Upstream | `https://github.com/xmanrui/dsh-im` |
| Version | `v3.0.1` |
| Annotated tag object | `36c099299557ed053517018c0f6ac2762e6961e2` |
| Peeled commit | `fb8a9df652ed6eaa4b99a9338cab15db1b626b1c` |
| Archive URL | `https://codeload.github.com/xmanrui/dsh-im/tar.gz/fb8a9df652ed6eaa4b99a9338cab15db1b626b1c` |
| Archive SHA-256 | `7db84c13cdb434b2c13690aace527ff8a7dbdf6bfc947c2e6c661dcc28bbffaf` |
| Archive bytes | `9833777` |
| License | MIT |
| Tag signed | **no** — unsigned annotated tag; `verification.verified=false`, `reason=unsigned` |
| Tagger date | 2026-08-26T01:29:58Z |
| Fetched | 2026-08-26 |
| Generated `lib/` | **not copied** |
| Whole runtime | **not installed** |

The SHA-256 above is of the GitHub commit tarball for peeled
`fb8a9df652ed6eaa4b99a9338cab15db1b626b1c`. Do not treat tag name `v3.0.1` as a
substitute for the peeled commit or the archive hash.

Official DSH at this fetch remains `0.1.1-rc.2` /
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (npm `latest` and `next`).

## v3.0.0 → v3.0.1 (8 commits)

Peeled `40b5a46516b44e30fa90e084400a8c3d578214e9` …
`fb8a9df652ed6eaa4b99a9338cab15db1b626b1c`:

1. `9d3700b1cd89a811bceeb69bedfac2715c9a1df1` — `fix(qq): deliver C2C replies as markdown`
2. `f79375a0b0e0200ba4bb30eb48dacfbe764e1bb9` — `fix: polish English settings UI`
3. `c62032f2c382ae9ece0f4a0f5fac15101e54f322` — `fix: contain Telegram card layout`
4. `e8ef0725764bfb7a8182a8f5f8505c20a5cdabe8` — `docs: add English interface preview`
5. `8f03c66775c8cfe28b35238a633e2fcae396574c` — merge PR #60 QQ C2C markdown
6. `f4deb4ac2094ee804cd35e85b892f4f59cafacca` — `fix: show version tooltip below brand`
7. `ea5176be93cf0a5959397bd15d3ef614811a2a67` — `fix(qq): harden markdown reply delivery`
8. `chore: release v3.0.1`

The previously separate post-tag audit of `ea5176be` is now **inside** v3.0.1.
Do not treat that SHA as a second current pin.

Changed source (not generated `lib/`):

| Upstream | Penglai decision |
|---|---|
| `src/channels/qq/markdown-reply.mjs` | rewrite already in `packages/channel-qq/src/markdown-reply.ts` (fences, GFM tables, unique seq, Unicode-safe split, C2C passive quota of 4 plus continue notice, fallback only on markdown rejection) |
| `src/channels/qq/qq-runtime.mjs` / `qq-bridge.mjs` | rewrite send path already uses markdown helper; harness-client remains forbidden |
| `plugin-src/client/channels/telegram/styles.js` | **narrow principle only**: Messaging cards must not overflow; do not copy DSH-IM Web Host |
| `plugin-src/client/styles.js` / `i18n.js` | **narrow principle only**: English copy on Penglai cards; do not copy DSH-IM UI |
| `lib/**`, `package.json`, changelog, screenshots | forbidden / not product |

No `src/channels/weixin/**` files change in this range.

## Weixin v2.5.0 → v3.0.1 (file-level)

Same filenames at v2.5.0 (`aa8fd71`) and v3.0.1 (`fb8a9df`):
`weixin-api.mjs`, `weixin-runtime.mjs`, `weixin-bridge.mjs`,
`weixin-controller.mjs`, `config-store.mjs`, `state-store.mjs`,
`harness-client.mjs`.

| Upstream | Decision |
|---|---|
| typing in `weixin-runtime.mjs` (v2.5.0 delta) | **absorbed as rewrite** into Penglai iLink `getconfig` + `sendtyping`; never replace iLink |
| `weixin-api.mjs` / controller / runtime receive-send | **rejected** — Penglai keeps official iLink |
| `harness-client.mjs` | **forbidden** |
| `config-store.mjs` / `state-store.mjs` | **forbidden** — Vault + Penglai SQLite |
| `weixin-bridge.mjs` session binding | **forbidden** — official DSH Turn only |

## Forbidden upstream surfaces

- `lib/` generated output
- `bin/` including `bin/dsh-im.mjs`
- `cordis.patch.yml`
- DSH-IM harness client / session coordinator / config/state stores
- DSH-IM Office, CLI, worker
- Weixin replacement of Penglai iLink
- Feishu replacement of Penglai official Lark SDK

File-level mapping lives in `DSH_IM_PORT_LEDGER.md`.
