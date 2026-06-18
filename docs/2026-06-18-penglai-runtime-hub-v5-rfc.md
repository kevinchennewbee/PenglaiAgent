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
- `penglai_runtime.runner.AgentRunner`
- `penglai_runtime.hub.PenglaiRuntimeHub`
- `penglai_runtime.channel_runtime.ChannelRuntimeBridge`
- `penglai_runtime.delivery.plan_delivery`
- `penglai_runtime.delivery.DeliveryService`
- `penglai_runtime.interaction.InteractionRequest`
- `penglai_runtime.text_interaction.install_text_interaction_adapter`
- `penglai_runtime.output_cleaner.clean_final_text`
- `penglai_runtime.memory_governor.MemoryGovernor`
- `penglai_runtime.in_memory_im.InMemoryIMAdapter`
- `penglai_runtime.shadow.record_delivery_shadow`
- terminal self-check: `penglai v5 --json`
- module self-check: `python3 -m penglai_runtime.selfcheck --json`

Most contracts are side-effect free by default. `DeliveryService` executes only
through adapter-provided callbacks, so platform SDK behavior stays owned by the
IM adapter. `InteractionRequest` describes the intent to ask the user; Feishu
can render it as a button card, while channels without stable card support use
the same numbered/open-text fallback. The automated in-memory adapter is only a
test double for contract verification; it is not a user-facing demo IM.

The current real-entry integration is:

- Feishu: native card buttons through `penglai_feishu_ask.py`, structured callback values, V5 shadow delivery planning, and final-text A/B/C prompt promotion into cards.
- WeChat: `penglai_im_launch.py wechat` is the supported launch path; it records V5 event/session state, uses `InteractionRequest` text fallback, records memory/shadow decisions, and delivers generated artifacts through `DeliveryService`.
- DingTalk, QQ, and WeCom: `install_text_interaction_adapter()` now delegates to `ChannelRuntimeBridge`, so the real `run_agent` path uses `InboundEvent`, `SessionRouter`, FIFO queueing, `InteractionRequest`, `MemoryGovernor`, and delivery shadow. These channels still use text fallback rather than native button cards.
- Telegram: text, callback, photo, and document entries now create V5 runtime events and use the V5 interaction extraction/prompt contract while preserving Telegram's existing inline-menu UI.
- Discord: the real `run_agent` path is patched through `ChannelRuntimeBridge`; ask_user choices render as Discord native buttons, and final artifacts use the V5 delivery plan.
- Desktop bridge, TUI v2/v3, and Qt: local client submissions now create V5 runtime events and use the same owner-session/default prompt contract, so they are no longer disconnected future-client paths.
- Launchers: `penglai_channels.py` and `launch.pyw` route Feishu to `penglai_feishu_app.py` and WeChat/DingTalk/QQ/WeCom to `penglai_im_launch.py`, avoiding direct startup of older bypass paths.

When `PENGLAI_RUNTIME_HUB_SHADOW=1` is set, V5-aware wrappers record a
privacy-conscious delivery plan to `temp/penglai_runtime_shadow.jsonl` after a
task completes. The record stores redacted text previews, hashed receive ids,
artifact basenames/statuses, and counts. It never sends messages or files by
itself; delivery remains adapter-owned.

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
- Native interaction widgets when the platform supports them.

### Runtime-owned

- Normalized inbound events.
- Session ownership and group/private isolation.
- Per-session FIFO queueing and stop/cancel state.
- Delivery planning: text, artifacts, blocked/missing files, and user-facing notices.
- Interaction planning: question, options, callback payload, and text fallback.
- Output cleanup: `LLM Running`, tool leftovers, empty final states.
- Memory governance boundaries and skill-trigger hygiene.

## 0.2.20 V5 test cut

This branch deliberately does not replace GA as the execution engine. It also
keeps platform SDK loops, credentials, uploads, and reconnect behavior inside
the existing adapters. The change is a Penglai-layer runtime replacement: real
entry points now normalize inbound events, route sessions, queue busy work,
plan interactions, apply memory hygiene, and plan delivery through shared V5
contracts before and after calling GA.

The safe 0.2.20 test cut now includes:

1. Add Penglai-owned V5 contracts and in-memory adapter tests.
2. Keep GA core unchanged; Penglai-owned wrappers and launchers are the V5 migration surface.
3. Add `penglai v5` as a validation command for the test branch, not a new daily user workflow.
4. Add privacy-preserving shadow-mode delivery planning for V5-aware channels.
5. Move generated-file delivery through `DeliveryService` so duplicate API sends,
   missing files, sensitive suffix blocks, and user notices are shared behavior.
6. Move Feishu `ask_user` and button choices onto `InteractionRequest` so user
   confirmation/selection is a real runtime contract, not a one-off demo card.
7. Move WeChat, DingTalk, QQ, and WeCom ask_user fallback onto the same
   `InteractionRequest` path without native-card claims.
8. Add `AgentRunner`, `PenglaiRuntimeHub`, and `MemoryGovernor` so session
   routing, queueing, output cleanup, delivery, and memory-write hygiene can be
   tested as one Penglai-owned contract surface.
9. Bring Telegram and Discord onto V5 interaction/session/delivery contracts
   while preserving their native UI affordances.
10. Bring desktop bridge, TUI, and Qt submissions onto V5 event/session/prompt
    contracts as the foundation for future multi-platform clients.

## What must not be claimed yet

- Do not claim GA core has been rewritten; GA remains the execution engine.
- Do not claim every IM has native button rendering; text fallback is the common contract until adapters opt in.
- Do not claim MemoryGovernor solves all memory pollution for all users; it is a Penglai boundary layer over existing memory writes.
- Do not claim 0.2.20 is ready to replace `main`.

0.2.20 is a test branch for validating the V5 Runtime Hub architecture before it becomes the mainline architecture.

## Verification gates

Minimum local gates before sharing this branch:

- `python3 tests/test_penglai_runtime_v5.py`
- `python3 tests/test_artifacts.py`
- `python3 tests/test_fileguard.py`
- `python3 tests/test_feishu_ask_user.py`
- `python3 tests/test_memguard.py`
- `python3 tests/test_im_voice.py`
- `python3 tests/test_wizard_i18n.py`
- `python3 -m penglai_runtime.selfcheck --json`
- `PENGLAI_RUNTIME_HUB_SHADOW=1 python3 -m penglai_runtime.selfcheck --json`
- `git diff --check`

Manual gates after sharing:

- test in a non-Mac-mini environment first;
- Feishu real workflow still behaves as 0.2.10;
- file delivery, ask_user, queueing, and companion behavior are observed by the user before any merge-to-main decision.
