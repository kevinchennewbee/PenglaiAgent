# Penglai Desktop Runtime Payload

This directory is populated by `packaging/build_desktop_runtime.py` during
desktop release builds. Generated files are intentionally ignored by git.

Expected generated layout:

```text
manifest.json
source/
  penglai
  agent_loop.py
  frontends/desktop_bridge.py
  .venv/
```

The Tauri shell uses this payload first on initial runtime setup. Online
`install.sh` / `install.ps1` bootstrap is only a fallback when the packaged
payload is absent.
