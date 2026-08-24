# ADR 0035 — Artifact Service

- Status: Accepted
- Date: 2026-08-24
- Version: Penglai 0.5.6 implementation
- Requirements: R56-FILE-001 .. R56-FILE-016, R56-SEC-013, R56-OFF-006

## Context

Office, Memory, IM, and conversation files currently use separate permission stories. Official DSH rc.2 conversation attachments are images only. Penglai still needs one internal byte store so models and adapters never receive arbitrary real paths.

## Decision

1. Add an internal package `@penglai/artifacts`. It is not an Agent plugin, not a second Core, and does not call a model.
2. Public handle is `ArtifactRefV1`: content-addressed `sha256:`, display name without path, media type, byte length, source, and scope (`turn` | `workspace` | `memory-source`).
3. Intake: native picker/drop handle only; reject symlink/device/socket/directory/path escape; stage-copy while hashing; magic plus declared MIME; format policy; atomic move into private CAS (dir 0700, file 0600); SQLite scope/TTL; return path-free refs.
4. 0.5.6 admit list: `.docx` `.xlsx` `.pptx` `.pdf` `.txt` `.md` `.csv`. Limits: 8 MiB per file, 5 files per Turn, 24 MiB per Turn. Reject macros, encrypted documents, executables, script packs, nested archives, and unknown binaries.
5. Default scope is Turn. Persist to Workspace or Memory Source requires an Owner Receipt. GC covers CAS, index, staging, WAL, and backup refs.
6. Official composer binding waits for R56-FILE-016 GO. Current rc.2 spike is BLOCKED. Do not use DOM overlay, a second chat, image disguise, or invisible prompt text.

## Consequences

- Office and IM can share ArtifactRef before composer file intake exists.
- Models and adapters only get refs or capability-limited readers.
- If DSH later ships generic file blocks, re-run the spike and replace this BLOCKED composer clause.
