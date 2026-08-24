# DSH 0.1.1-rc.1 compatibility report

> **Historical 0.5.1 report.** It no longer defines the current product pin.
> Penglai 0.5.6 uses official DSH `0.1.1-rc.2`; see `DSH_011_RC2.md` and
> `release-contract.json`.

Freeze: `@deepseek-ai/dsh@0.1.1-rc.1`, GitHub tag `dsh-v0.1.1-rc.1`, commit `528c682e061696f5a160f363f236ecbf53cbd006`, npm integrity `sha512-HVauMT0F7MWUctkxzBcu5PMFc8j0lm0kX+4IbcUsA7Oh+/xv7xhigEDP0SaSOM/kR48U/BldHbZru116DcZz0w==`.

This is the 0.5.1 kernel report. It replaces ADR 0031 as the current pin, not as historical evidence.

## Identity and lifecycle

- Agent/Workspace/Session/Turn remain official DSH services. Penglai does not add a parallel runtime.
- Workspace records live in the official `workspace` storage domain (`workspace.json` under `DSH_HOME`), keyed by workspace id with canonical `path`. Empty `dsh-home/workspaces/<id>` directories are not official facts.
- Session logs are JSONL under the session-persistence root: `projectDir(root, cwd)/<sessionId>/session.jsonl`.
- `ToolRunContext` identity for tools is `exec.agent.id`.

## Credentials

- `CredentialProvider` still owns `resolve` / `describe` / `set` / `unset`.
- rc.1 adds record APIs: `readRecord`, `describeRecord`, `listRecords`, `modifyRecord`, `deleteRecord`.
- The firehose event is `credentials/reference-updated` (rc.8 `credentials/updated` is gone).
- Penglai in-memory test provider implements the record half so it remains a real subclass.

## UI overlay

- Official brand slots (`sidebar.brand.*`, `conversation.hero.brand.mark`) stay official.
- Penglai UI overlay is `overlays/dsh-0.1.1-rc.1`, exact upstream/patched SHA-256, fail closed on drift.
- `dsh-client-ui-settings-general` client bytes match rc.8; the settings-submenu transform is reused.
- Web frontend index and welcome/hero client bytes changed; patches were re-derived, not renamed.

## Plugins and profile

- Loader inventory, Cordis `disabled`, and profile bundles remain the install/enable source of truth.
- Remote plugins must add a loader row; toggling `disabled` on a missing row is not an install.
- First-party plugins pin `dsh.exact = 0.1.1-rc.1`.

## Closure

- Direct DSH packages and leftover peers (`dsh-invariants`, `dsh-timeout`, `dsh-scope`, and the other rc.6 leftovers) are overridden to `0.1.1-rc.1`. Dual instances of the same DSH service are a release FAIL.

## Storage migration

- rc.8 → rc.1 user-data migration is a separate 0.5.1 product path: versioned backup of `Penglai/0.5`, preserve credentials/workspace/session/settings/plugin desired state, fail closed and restore on error.
- 0.4.1 is still a different generation and is not imported.
