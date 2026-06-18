# Penglai Runtime Hub V5 RFC - 0.2.20 test branch

Date: 2026-06-18
Branch: `codex/0.2.20-v5-test`
Base: `5e7cf5f` (`v0.2.10 hotfix`)
Target version: `0.2.20-v5-test`

## Decision

0.2.20 is a V5 test build on top of the complete 0.2.10 codebase. It is not a new product line and not a rewrite. All existing 0.2.10 fixes remain present unless explicitly audited later.

V5 means contract-first anti-wrapper architecture:

- keep GA as the execution engine;
- keep existing IM frontends working by default;
- move common Penglai behavior into small Penglai-owned contracts;
- let Feishu, WeChat, Telegram, Discord, desktop, and voice become adapters over those contracts;
- do not make a heavy platform, new memory system, or Feishu-centered wrapper.

## What this branch proves

This branch introduces the first test surface for V5:

- `penglai_runtime.contracts.InboundEvent`
- `penglai_runtime.session.SessionRouter`
- `penglai_runtime.queueing.SessionQueue`
- `penglai_runtime.delivery.plan_delivery`
- `penglai_runtime.output_cleaner.clean_final_text`
- `penglai_runtime.fake_im.FakeIMAdapter`
- `penglai_runtime.shadow.record_delivery_shadow`
- `penglai v5` self-check

These are side-effect free by default. They do not replace the current Feishu or WeChat production paths.

When `PENGLAI_RUNTIME_HUB_SHADOW=1` is set, the Feishu wrapper records a
privacy-conscious V5 delivery plan to `temp/penglai_runtime_shadow.jsonl` after
a task completes. The record stores redacted text previews, hashed receive ids,
artifact basenames/statuses, and counts. It never sends messages or files and
does not change the legacy Feishu path.

## Current evidence and debt

After refreshing `upstream/main`, Penglai still has some tracked differences from upstream frontends because 0.2.x added user-facing distribution behavior, especially unified IM artifact delivery. V5 treats these differences as migration debt: future work should explain each diff and, where feasible, move Penglai behavior back into Penglai-owned modules.

The 0.2.20 branch also syncs two upstream-risk areas before adding the V5 test surface:

- `agentmain.py` reflect loop throttling is aligned with upstream.
- `frontends/slash_cmds.py` `/update` guidance is aligned with upstream's fuller working-tree reconciliation flow.

## Boundary rules

- Feishu is a pressure-test sample, not the architecture center.
- Do not hard-code one user's personal workflow as universal routing policy.
- Do not block legitimate LLM self-repair behavior such as reading config paths or official API docs.
- Use redaction, suffix-based outbound gates, and reliable delivery instead of limiting the agent's reasoning.
- New V5 behavior must be opt-in, shadow-mode capable, and old-path fallback safe.

## Responsibility map

### Adapter-owned

- IM SDK, credentials, WebSocket or polling loop, and reconnect mechanics.
- Platform identity mapping such as open_id, chat_id, receive_id_type, or group id.
- Message parsing and media download.
- Upload primitives, file keys, image keys, card rendering, and platform-specific button UI.

### Runtime-owned

- Normalized inbound events.
- Session ownership and group/private isolation.
- Per-session FIFO queueing and stop/cancel state.
- Delivery planning: text, artifacts, blocked/missing files, and user-facing notices.
- Output cleanup: `LLM Running`, tool leftovers, empty final states.
- Memory governance boundaries and skill-trigger hygiene.

## 0.2.20 minimal cut

This branch deliberately does not replace `penglai_feishu_app.py` or `frontends/fsapp.py`.

The safe 0.2.20 test cut is:

1. Add Penglai-owned V5 contracts and fake adapter tests.
2. Keep real Feishu/WeChat/Telegram/Discord behavior unchanged by default.
3. Add `penglai v5` so testers can confirm the V5 test surface exists.
4. Add Feishu shadow-mode delivery planning for observation only.
5. Keep delivery and output-cleaner logic reusable but not forced into production paths yet.
6. Prepare future migration of wrapper responsibilities into `DeliveryService`, `OutputCleaner`, and `AgentRunner`.

## What must not be claimed yet

- Do not claim the V5 runtime has replaced Feishu or WeChat.
- Do not claim cross-IM continuity is complete.
- Do not claim memory pollution is solved for all users.
- Do not claim 0.2.20 is ready to replace `main`.

0.2.20 is a human-test branch for validating whether the V5 direction is correct before it becomes the mainline architecture.

## Verification gates

Minimum local gates before sharing this branch:

- `python3 tests/test_penglai_runtime_v5.py`
- `python3 tests/test_artifacts.py`
- `python3 tests/test_fileguard.py`
- `python3 tests/test_feishu_ask_user.py`
- `python3 penglai v5 --json`
- `PENGLAI_RUNTIME_HUB_SHADOW=1 python3 penglai v5 --json`
- `git diff --check`

Manual gates after sharing:

- test in a non-Mac-mini environment first;
- Feishu real workflow still behaves as 0.2.10;
- file delivery, ask_user, queueing, and companion behavior are observed by the user before any merge-to-main decision.
