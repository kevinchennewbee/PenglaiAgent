# ADR 0040 — DSH-IM v2.4.0 selective port into one IM Core

- Status: Superseded by ADR 0044 for the current 0.5.7 DSH-IM pin
- Date: 2026-08-25
- Related: ADR 0037 (IM registry / multi-bot)

## Context

`xmanrui/dsh-im` v2.4.0 contains QR and token flows for nine IM channels plus
an Office implementation and its own Harness client. Penglai already has a
single `@penglai/im` plugin, Weixin iLink, Feishu official SDK, Vault, Owner
Broker, Artifact Service, and DSH as the only agent.

## Decision

1. Pin review to unsigned tag `v2.4.0`, peeled commit
   `7211534aeff01dba4ab78c79a5fa31cb9fa9510f`. Record tarball SHA-256 in
   provenance. Do not auto-follow newer DSH-IM tags.
2. Users see one Messaging plugin. Internal packages
   `channel-{weixin,feishu,dingtalk,wecom,qq,slack,telegram,discord,whatsapp}`
   are not user-visible plugins.
3. Port by rewrite: authentication, transport, health, and media conversion
   only. Credentials go through official DSH credentials + Penglai Vault.
4. Forbidden: `lib/`, `bin/`, `cordis.patch.yml`, DSH-IM harness
   client/presets/session binding, DSH-IM config stores, DSH-IM Office,
   replacing Penglai Weixin or Feishu.

## Consequences

- Baileys, if executed in production, is a direct auditable dependency, not a
  silent devDependency.
- Slack/Telegram/Discord prefer Node 22 fetch/WebSocket; do not add large SDKs
  without cause.
