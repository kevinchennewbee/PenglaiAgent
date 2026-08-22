# Penglai 0.5.2

Penglai 0.5.2 is a focused onboarding and update-reliability release. It keeps official DeepSeek Harness `0.1.1-rc.1` as the only core and ships the same three community-verified targets: `darwin-aarch64`, `darwin-x86_64`, and `win32-x86_64`.

## Fixed

- The final setup gate now reads the real rc.1 workspace, session, compression, and credential layouts. A successful API test and first official Turn no longer end in a false workspace error.
- Back navigation now rewinds the persisted onboarding ledger and clears dependent evidence. Re-entering a key, choosing another model, or replacing a Workspace is a real reconfiguration rather than a visual-only change.
- First-Turn authentication failures return to credential entry, and completion-evidence failures no longer masquerade as workspace-jail errors.
- Regression coverage reproduces a completed flow, rewinds it, replaces credentials, creates a Workspace, sends another official Turn, and completes again.

## Upgrade

Penglai 0.5.1 users can open **Penglai → Update**, choose **Check for updates**, download the signed 0.5.2 installer, and confirm the normal system installer. The updater enumerates stable immutable GitHub Releases, verifies the Penglai Ed25519 signature and exact installer hash, and never installs silently. User data under the `Penglai/0.5` generation and external Workspaces are preserved.

Penglai 0.5.0 still requires a manual 0.5.2 overlay on Apple Silicon because 0.5.0 did not contain this production update trust path. Intel Mac and Windows x64 users can install 0.5.2 directly.

## Trust and platform limits

This remains a `community-verified` release. macOS packages are ad-hoc signed and not notarized; Windows is not Authenticode signed. Gatekeeper or SmartScreen may warn. Do not disable system security. Updates require user confirmation and are not silent.

The Plugin Center continues using the signed public [Penglai Plugin Registry](https://github.com/kevinchennewbee/PenglaiPluginRegistry). A client update is not required merely to publish another compatible, signed catalog generation or plugin archive.
