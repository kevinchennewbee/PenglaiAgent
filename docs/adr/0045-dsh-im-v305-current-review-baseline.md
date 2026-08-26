# ADR 0045 — DSH-IM v3.0.5 is the current 0.5.7 review baseline

- Status: Accepted
- Date: 2026-08-26
- Supersedes: ADR 0044 for the **current** 0.5.7 DSH-IM review baseline only
- Related: ADR 0037, ADR 0041

## Context

DSH-IM published unsigned annotated tag `v3.0.5`: tag object
`63bdfc72be1289097e3c73acb95ba9260531091d`, peeled commit
`64587b3b6162fa34f1c3ddb335a254d4154c9175`. Penglai reviews DSH-IM as a
community source of channel ideas. It does not install DSH-IM as another
plugin runtime, Agent core, conversation engine, configuration store, Office
worker, or Harness client.

## Decision

1. The current 0.5.7 DSH-IM review baseline is unsigned `v3.0.5`, with exact
   archive and license hashes in
   `docs/0.5.7/provenance/dsh-im-v3.0.5.md` and `third_party/sources.lock.json`.
2. Penglai retains one user-facing Messaging plugin and one Penglai-owned IM
   control plane. Internal `channel-*` packages remain implementation details.
3. Ideas are reviewed and selectively rewritten under Penglai's contracts.
   Generated output, runtime, Harness integration, configuration, Office, and
   duplicate Weixin/Feishu implementations are not imported.
4. The v3.0.3 responsive status placement is independently implemented. The
   v3.0.5 international host change is narrowed to exact
   `ilinkai.wechat.com`; lookalikes and arbitrary subdomains remain rejected.
5. WeCom intermediate thinking/tool output is not sent to external channels.
   WhatsApp groups remain unsupported and private-only, matching Penglai policy
   and the upstream v3.0.4 revert.

## Consequences

- README, website, NOTICE, SBOM, lock data, and current provenance must identify
  v3.0.5 without rewriting historical review records.
- A platform is publicly called supported only after its redacted installed
  live row passes. Source and contract tests prove implementation, not accounts.
- Real QR/device-link is shown only where the vendor actually supplies it.
  Slack, Telegram, and Discord retain their official non-QR setup paths.
