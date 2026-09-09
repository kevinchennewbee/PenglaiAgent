# Electron 31.7.7 linux-loong64 — UOS 20 provenance

This is **not** a production-security PASS and **not** a Chromium 150
equivalent of Mac/Windows Electron 43.6.0. It is the newest Loongson
vendor zip whose bytes were actually read as old-world on 2026-09-09.

## Exact pin (actual bytes)

| Field | Value |
| --- | --- |
| Provider | Loongson ftp vendor tree (`ftp.loongnix.cn`), not electron/electron CI |
| URL | `https://ftp.loongnix.cn/electron/LoongArch/v31.7.7/electron-v31.7.7-linux-loong64.zip` |
| SHA-256 | `e0c756ca8a66dde3bece6ad902f152f539365ce7442d6353871d7c54d1c0f47b` |
| Size | 151528692 |
| Zip members dated | 2025-02-06 |
| LICENSE | Electron MIT (in zip) |
| `electron` ELF | interpreter `/lib64/ld.so.1`, `for GNU/Linux 4.15.0`, GLIBC ≤ 2.28 |
| `chrome-sandbox` | same old-world loader |
| Chromium | `126.0.6478.234` |
| Embedded Node | 20.18.0 / `NODE_MODULE_VERSION` 125 |
| `node_headers` | shipped next to the zip on the same ftp directory |

ftp.loongnix.cn has **no newer LoongArch Electron than 31.7.7**. Official
Electron 31 / Chromium 126 is EOL. Public patch/CVE maintenance after
2025-02-06 is **unproven**. Do not call this train maintained.

## What was searched (compact; do not restart)

- Official Electron 43.6.0 `linux-loong64` zip: HTTP 404.
- darkyzhou/electron-loong64 43.x: new-world, glibc ≥ 2.38, LSX. Not UOS 20.
- libLoL: old-world-on-new-world. Does not run Electron 43 on UOS 20.
- No public old-world Electron 43 / Chromium 150 recipe.

## PM shipping decision (2026-09-09)

**Option B is selected** under Owner full-release and exact UOS 20
constraints. Ship the proven Loongson Electron **31.7.7 / Chromium 126**
bytes. Disclose unproven ongoing maintenance. Do **not** claim security
parity with Mac/Windows Electron 43 / Chromium 150. Preserve sandbox.
This is not native UOS PASS.

| Option | Status |
| --- | --- |
| **B. Ship 31.7.7 with this disclosure** | **Selected.** Viable ABI for UOS 20. Chromium 126 vs Mac/Windows 150 must stay in README/site. Not a security-equivalent pin. |
| **C. Source-build Electron 43 old-world** | Not taken. No public recipe. Builder class is tens of GB RAM. Not authorized paid infra. |
| **D. Upgrade the client OS to UOS V25** | Not taken. Owner did not request this. |

Native install/startup/function remain `OWNER_POST_RELEASE`. Final
publication still waits the four freeze artifacts and PM GUI/design
handoff.
