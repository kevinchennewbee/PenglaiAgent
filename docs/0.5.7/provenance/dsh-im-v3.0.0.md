# dsh-im v3.0.0 supply-chain record

This is the **current** 0.5.7 DSH-IM provenance baseline. v2.4.0 and v2.5.0
remain historical. Penglai does **not** install this package as a second Agent
core or copy generated `lib/`.

Selected channel authentication, transport, typing, reaction, markdown, and
structured failure ideas may be rewritten into `@penglai/im`. The post-tag
commit `ea5176be93cf0a5959397bd15d3ef614811a2a67` is audited separately and is
**not** v3.0.0 content.

## Identity

| Field | Value |
|---|---|
| Upstream | `https://github.com/xmanrui/dsh-im` |
| Version | `v3.0.0` |
| Annotated tag object | `881491704e7bddecc1ce937d53071865489df3f7` |
| Peeled commit | `40b5a46516b44e30fa90e084400a8c3d578214e9` |
| Archive URL | `https://codeload.github.com/xmanrui/dsh-im/tar.gz/40b5a46516b44e30fa90e084400a8c3d578214e9` |
| Archive SHA-256 | `791c2d7335cb524fb48b6e2939837709214842746be96df503dd5ca40f491c5b` |
| Archive bytes | `9434947` |
| License | MIT |
| Tag signed | **no** — unsigned annotated tag; `verification.verified=false`, `reason=unsigned` |
| Tagger date | 2026-08-25T15:00:29Z |
| Fetched | 2026-08-26 |
| Generated `lib/` | **not copied** |
| Whole runtime | **not installed** |

The SHA-256 above is of the GitHub commit tarball for peeled
`40b5a46516b44e30fa90e084400a8c3d578214e9`. Do not treat tag name `v3.0.0` as a
substitute for the peeled commit or the archive hash.

## Forbidden upstream surfaces

- `lib/` generated output
- `bin/` including `bin/dsh-im.mjs`
- `cordis.patch.yml`
- DSH-IM harness client / session coordinator / config/state stores
- DSH-IM Office, CLI, worker
- Weixin replacement of Penglai iLink
- Feishu replacement of Penglai official Lark SDK

File-level mapping lives in `DSH_IM_PORT_LEDGER.md`.
