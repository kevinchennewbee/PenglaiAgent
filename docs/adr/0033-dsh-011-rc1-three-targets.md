# ADR 0033 — DSH 0.1.1-rc.1 pin and three release targets

- 状态：Accepted
- 日期：2026-08-21
- 取代：ADR 0031 的 current product pin；D-054 的“0.5.x 只发 Apple Silicon”作为 0.5.1 范围

## Context

Penglai 0.5.0 froze `@deepseek-ai/dsh@0.1.0-rc.8`. On 2026-08-21 official DSH published `0.1.1-rc.1` to npm, tagged `dsh-v0.1.1-rc.1` at `528c682e061696f5a160f363f236ecbf53cbd006`, and listed the GitHub Release. 0.5.1 must also ship Intel macOS and Windows x64 clients, a real hot-updatable plugin center, and a post-0.5.1 app-update protocol. 0.5.0 cannot be retrofitted for automatic upgrade.

## Decision

1. Pin every direct DSH package to exact `0.1.1-rc.1` with the live npm integrity. Never follow `latest` or `next`.
2. Declare three target keys: `darwin-aarch64`, `darwin-x86_64`, `win32-x86_64`. Asset filenames keep `macos_x64` / `windows_x64`; vendor archives keep `darwin-x64` / `win-x64` / `win32-x64`. Selection always uses the target key.
3. Native PASS requires a matching runner. Apple Silicon cross-builds and Rosetta are not Intel native evidence. Windows preflight is not Windows native evidence.
4. 0.5.0 → 0.5.1 on Apple Silicon is a manual overlay install. 0.5.1 → later same-platform versions use PUDP.
5. PPDP is in-scope for 0.5.1. Remote plugins must enter the official DSH loader/profile, not only a download directory.

## Consequences

- rc.8 overlay, identity constants, lockfile, profile seed, and first-party plugins must be re-derived against rc.1.
- Missing Intel or Windows runners leave those targets `BLOCKED`.
- Publication still requires an offline backup of the Ed25519 roots.
