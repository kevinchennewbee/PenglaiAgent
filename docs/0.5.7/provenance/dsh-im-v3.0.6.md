# dsh-im v3.0.6 post-pin review

Penglai 0.5.7 keeps `v3.0.5` as its frozen selective-reference pin. This
record proves that the later `v3.0.6` release was reviewed rather than silently
ignored. DSH-IM is not installed or bundled as a Penglai runtime.

## Identity

| Field | Value |
|---|---|
| Upstream | `https://github.com/xmanrui/dsh-im` |
| Release | `v3.0.6`, published `2026-08-26T14:26:57Z` |
| Annotated tag object | `1351e80da911bcdb8b768995fcc1302ee514e4c9` |
| Peeled commit | `c93f42f1cc1cdc8292f9803c378dc0fa520be4d2` |
| Compare base | `v3.0.5` / `64587b3b6162fa34f1c3ddb335a254d4154c9175` |
| Archive SHA-256 | `d190fe26b467cc4f1596865bc6e7b2cfc758b744b22619fb25d3f29f08523718` |
| Archive bytes | `9839785` |
| License | MIT |
| Tag signed | no; `verification.verified=false`, `reason=unsigned` |
| Reviewed | `2026-08-27` |

The compare contains three commits: a Weixin delivery-diagnostic fix, the
workspace-picker Issue #69 fix, and the release commit. Generated `lib/` and
release metadata are not product inputs.

## Decisions

| Upstream change | Penglai decision |
|---|---|
| Direct Windows drive, UNC, and POSIX path entry in the DSH-IM workspace picker | Not applicable. Penglai's onboarding uses an operating-system native directory picker and returns an opaque capability; it does not ship the DSH-IM picker. |
| Prevent selection of a previously viewed directory after a typed-path read failure | Not applicable for the same reason; Penglai's native selection is validated in Main before the Workspace is accepted. |
| Sanitized Weixin send diagnostics for partial long-message delivery | No re-port. Penglai's iLink adapter already preserves bounded `sendmessage-code-*` diagnostics and the single IM control plane maps failures to stable public codes, a reference id, and manual-confirmation policy without exposing raw provider details. |

None of the changes adds a platform, QR/device-link mechanism, authentication
transport, message reaction, Office capability, Memory capability, security
fix affecting Penglai's rewritten code, or a new official DSH seam. Re-pinning
would invalidate the frozen candidate without adding product behavior, so
`v3.0.5` remains the 0.5.7 reference baseline.
