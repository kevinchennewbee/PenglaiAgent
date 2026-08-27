# dsh-im v3.0.2 supply-chain record

This is the **current** Penglai 0.5.7 DSH-IM review baseline. Penglai does not
install DSH-IM as another Agent core and does not copy its generated `lib/`,
`bin/`, Harness client, config store, Office worker, or runtime.

## Identity

| Field | Value |
|---|---|
| Upstream | `https://github.com/xmanrui/dsh-im` |
| Version | `v3.0.2` |
| Annotated tag object | `5f78dfbc7da9eda1c2298a1d5192af0b6d8adcb5` |
| Peeled commit | `54468bbe1e93b30ae5778941cd65e725877dae74` |
| Archive URL | `https://codeload.github.com/xmanrui/dsh-im/tar.gz/54468bbe1e93b30ae5778941cd65e725877dae74` |
| Archive SHA-256 | `8f4b489477361b8e091aafde7e4929967cf2f361f5fe2c5386a44b2d2603112b` |
| Archive bytes | `9833681` |
| License | MIT |
| Tag signed | no; `verification.verified=false`, `reason=unsigned` |
| Tagger date | `2026-08-26T06:40:51Z` |
| Fetched | `2026-08-26` |

Official DSH was refreshed at the same time: Git tag, npm `latest`, and the
default `master` branch all remain `0.1.1-rc.2` at commit
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

## v3.0.1 to v3.0.2 review

The only product change is a permanently visible DSH-IM version beside its
settings-page brand heading. The remaining changed files are release metadata,
generated bundles, package version, and changelog. No channel transport,
authentication, route, Office, Weixin, Feishu, or credential logic changed.

Penglai adopts the narrow usability principle only: its Messaging page shows
`Penglai IM 0.5.7` visibly without hover. It does not copy DSH-IM UI code.
All v3.0.1 selective rewrites and rejections remain recorded in
`dsh-im-v3.0.1.md` and `DSH_IM_PORT_LEDGER.md`.
