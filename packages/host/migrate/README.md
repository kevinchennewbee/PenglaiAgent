# Penglai 0.3 -> 0.4 Migration

One-shot migration from the 0.3 Python agent stack to the 0.4 TypeScript Host.
Aligned with `docs/0.4/09-MIGRATION-AND-CUTOVER.md`.

The migration script is **stdlib-only Python 3.12** (no pip installs) and is
safe by default: it backs up 0.3 data, previews every change, and asks for
confirmation before writing anything.

## Run

```bash
# Interactive wizard (recommended)
python packages/host/migrate/migrate_03_to_04.py

# Non-interactive, pointing at a specific 0.3 install
python packages/host/migrate/migrate_03_to_04.py \
    --source /path/to/0.3 \
    --output packages/host/migrate/out \
    --yes
```

Flags:
- `--source DIR` &nbsp; 0.3 install root (default: auto-detect from the repo)
- `--output DIR` &nbsp; where to write 0.4 config (default: `packages/host/migrate/out/`)
- `--yes` &nbsp; accept all defaults (non-interactive)
- `--no-backup` &nbsp; skip the 0.3 backup (not recommended)
- `--no-keys` &nbsp; do not emit the `.env.penglai` key template

## What gets migrated

| 0.3 asset | 0.4 destination | How |
|-----------|-----------------|-----|
| `mykey.py` model configs (`native_oai_config`, `native_claude_config*`, `oai_config*`, …) | `profiles.json` (0.4 `ModelProfile` catalog) | Each session dict with an `apibase` + `model` is converted. Provider is inferred from the base URL / model name; `[1m]` context-beta suffix is stripped. |
| Model API keys | `.env.penglai` | Emitted as `apiKeyEnv` vars (canonical `OPENAI_API_KEY` etc. for known providers, `PENGLAI_PROFILE_<ID>_API_KEY` otherwise). Placeholders are commented out. |
| Feishu / WeChat / Telegram / QQ / WeCom / DingTalk credentials | `im_credentials.json` | Carried over verbatim from `mykey.py`. The 0.4 IM adapters read `mykey.py` directly, so this file is a backup/reference, not a runtime input. |
| `memory/` | preserved in place | Language-agnostic Markdown/Python data; the 0.4 Memory service reads the same directory. No conversion. |
| `skills/` | preserved in place | Language-agnostic Markdown; reused as-is. |

Output files (in `--output`):

- **`profiles.json`** &mdash; the 0.4 `ModelProfile` catalog. No secrets; each
  profile carries an `apiKeyEnv` name and (where relevant) a `note`.
- **`.env.penglai`** &mdash; API keys as env vars. **Secrets &mdash; gitignore it.**
- **`im_credentials.json`** &mdash; IM credentials preserved verbatim.
- **`register_profiles.py`** &mdash; helper that registers each profile into a
  running Host via the `config.createProfile` JSON-RPC method.
- **`migration_report.txt`** &mdash; human-readable summary.

## What does NOT migrate (start fresh)

These are intentionally not migrated because the 0.4 formats are incompatible
or the concepts moved:

- **Runtime Hub state** (`temp/runtime_hub.sqlite3`) &mdash; 0.3 SQLite control
  plane vs 0.4 in-memory + JSONL transcripts. Start fresh.
- **Session history / transcripts** &mdash; 0.4 uses append-only JSONL with a
  different message shape (`MessageContent` union). Old L4 sessions are
  ignored; new transcripts are recorded as turns run.
- **Python plugins** (`plugins/penglai_*.py`) &mdash; redline/memguard safety
  concepts moved into the TS Boundary (`packages/host/src/policy.ts`,
  `jail.ts`). The Python plugin code is retired, not ported.
- **`mixin_config` failover rotation** &mdash; the 0.4 Host has no multi-model
  failover yet. The report records `llm_nos` and notes the first compatible
  profile becomes the primary; failover is a future Host feature.

## Anthropic-protocol caveat

0.3 `native_claude_*` configs speak the **Anthropic Messages protocol**
(`/v1/messages`, `x-api-key`). The 0.4 Host provider
(`packages/host/src/provider.ts`) only speaks **OpenAI-compatible**
`/chat/completions`. Such profiles are migrated and emitted to `profiles.json`
but flagged `compatible: false` with a note. To actually use them you must
either:

1. Point the profile at an OpenAI-compatible base URL for the same model, or
2. Wait for a 0.4 Anthropic-protocol provider adapter.

OpenAI-compatible configs (`native_oai_*`, `oai_*`, and Anthropic providers
that also expose an OAI endpoint) migrate cleanly with `compatible: true`.

## How to run (end-to-end)

```bash
# 1. Migrate
python packages/host/migrate/migrate_03_to_04.py --yes

# 2. Fill real API keys (the report tells you which vars)
#    edit packages/host/migrate/out/.env.penglai, then:
export $(grep -v '^#' packages/host/migrate/out/.env.penglai | xargs)

# 3. Start the Host
npm run serve

# 4. (Optional) register migrated profiles into the running Host
python packages/host/migrate/out/register_profiles.py

# 5. Start IM adapters
bash packages/host/bridge/start_im.sh
```

If you only use one of the default providers (Grok/DeepSeek/GLM/OpenAI),
skip step 4 and just set the canonical env var (`GROK_API_KEY` /
`DEEPSEEK_API_KEY` / `ZAI_API_KEY` / `OPENAI_API_KEY`) before `npm run serve`
&mdash; the Host's built-in default profiles pick it up automatically.

## Rollback

The script never deletes or modifies 0.3 files in place (it only reads
`mykey.py` and writes to `--output`). Rollback is therefore trivial:

- **Before cutover:** nothing to undo &mdash; 0.3 is untouched. Just keep
  running `agentmain.py` / `launch.pyw`.
- **After backup:** the timestamped backup dir
  (`penglai_03_backup_<TS>/`, sibling of the 0.3 root) contains
  `mykey.py`, `memory/`, `skills/`, `frontends/`, `agentmain.py`,
  `llmcore.py`, `penglai_runtime/`. Restore any of them by copying back.
- **Same-directory install:** if 0.3 and 0.4 share a directory (the script
  detects and reports `shared_with_04: true`), the 0.3 Python files and the
  0.4 `packages/` tree coexist; rolling back means stopping the TS Host and
  relaunching the 0.3 entrypoint. No file deletion is needed.
- **Memory/skills/credentials** are shared sources, so a rollback never loses
  user content (per `docs/0.4/09-MIGRATION-AND-CUTOVER.md` §4).

## Files

- `migrate_03_to_04.py` &mdash; the migration script. Stdlib-only.
- `out/` &mdash; generated config (gitignored; contains secrets in `.env.penglai`).
