# ADR 0036 — Memory Candidate and Recall

- Status: Accepted
- Date: 2026-08-24
- Version: Penglai 0.5.6 implementation
- Requirements: R56-MEM-001 .. R56-MEM-020, R56-OWN-002

## Context

0.5.5 Memory is mostly `remember/search/correct/forget`. The status page synthesizes lists with search words. There is no Turn-after candidate pipeline. Users cannot tell Workspace memory from personal memory.

## Decision

1. Four object kinds stay separate: Candidate, Confirmed Memory, Source, Recall Log. Candidates never enter recall.
2. Modes: Off, Suggest (default), Auto-current-workspace. Personal scope always needs an Owner Receipt. Auto never writes personal memory.
3. After official `turn/end` or a stable final session event, enqueue `(sessionId, turnId, sourceDigest)`. Ignore failed turns, tool noise, the curator session itself, duplicate finals, and incomplete streams.
4. Curator runs through official `ctx.agents.create/resume` and the current user Provider. Tools are denied with official `tools.guard`. Token limits apply. Output is host-validated against a closed JSON schema. There is no second SDK or endpoint. Provider-native `json_schema` is absent in DSH 0.1.1-rc.2 `GenerateOptions`; host validation is the schema gate.
5. Recall injects only confirmed current-Workspace plus confirmed personal memories, max 20 items / 2048 tokens, as untrusted fact/preference material. Workspace mismatch yields zero recall. Curator or recall failure Fail Opens and must not block the official Turn.
6. Delete the search-word fake list. Durable Memory provides real `list/filter/count`. Forget clears index, cache, and future recall; audit keeps tombstone id/digest only.

## Consequences

- 0.5.5 memories migrate as Confirmed with original scope. Unprovable scope goes to "pending attribution", never auto-personal.
- UI shows "this turn used N memories" plus source/correct/forget. Full internal prompts stay hidden.
- Automatic candidates stay Fail Open if the official Agent path degrades.
