# Penglai Memory data contract (0.5.5)

Physical layout under `PENGLAI_USER_DATA`:

```
memory/personal/mnemon.db
memory/workspaces/<sha256(official-workspace-id)>/mnemon.db
memory/runtime/USER.md
memory/runtime/workspaces/<hash>/MEMORY.md
memory/state/governance-ledger.sqlite3
```

- Personal and workspace stores are separate sqlite files named `mnemon.db`.
- Search opens personal + current workspace only.
- Candidate/quarantine records are not auto-recalled.
- AutoPrune is off.
- Mnemon v0.2.4 native binaries are identity-pinned in `third_party/sources.lock.json` and fetched by `scripts/fetch-mnemon-assets.mjs`. Source tests stay honest if the binary is not yet on disk (`R55-MEM-018` INCOMPLETE).
