# PUBLICATION_MANIFEST 0.5.0 (draft)

Status: **draft / UNFROZEN**. Exact hashes are filled only after the final source and DMG are frozen.

## Identity

| Field | Value |
| --- | --- |
| productVersion | `0.5.0` |
| candidateKind | `public-publication-candidate` |
| trustTier | `community-verified` |
| generationId | `penglai-dsh-v0.5` |
| phase | `UNFROZEN` |
| platform | Apple Silicon, macOS 13+ |
| macOS signature | ad-hoc, not notarized, no Developer ID |

## Pins

| Component | Pin |
| --- | --- |
| DSH | `0.1.0-rc.8` |
| Electron | `43.4.0` |
| Node | `22.22.2` |
| pnpm | `10.14.0` |
| optional first-party plugins | IM, ASR, MOSS-TTS, Context, Memory, Budget, Companion |

## Exact user installer

| Installer | SHA-256 | Installed evidence |
| --- | --- | --- |
| `Penglai_0.5.0_macos_aarch64.dmg` | _(UNFROZEN)_ | pending final exact-DMG suite |

Companion assets:

- `release-manifest.json`
- `SBOM.cdx.json`
- `THIRD_PARTY_NOTICES.txt`
- `SHA256SUMS`
- `public-export-manifest.json`

## Binding

| Field | Value |
| --- | --- |
| privateCandidateSourceSha | written at freeze |
| publicExportTreeSha256 | written by `prepare:public-export` |
| publicRepo | `kevinchennewbee/PenglaiAgent` |
| publicTag | `v0.5.0` |
| futurePublicCommitSha | written after push |
| updaterChannel | `NOT_PUBLISHED_0_5_0` |

## 0.4.1 boundary

0.4.1 → 0.5.0 is a clean generation. There is no updater bridge, secret import, session migration, or silent deletion of old data.

## Known limitations

- Apple Silicon only for 0.5.0; Intel Mac and Windows are future work.
- Community trust only; Apple publisher warnings may appear.
- No silent auto-update and no 0.5.0 updater channel.
- Fresh installs run DSH core and Center; all other Penglai plugins are optional and user-controlled.
- Weixin and Feishu are private-chat integrations only. Groups, images, ordinary files, video and rich cards are unsupported.
- Weixin inbound voice to local ASR and DSH text reply has been proven live. A native Weixin outbound voice bubble is not claimed.
- Voice model weights require explicit hash-verified download and are not embedded in the DMG.
- Context source directories are never app-managed; Companion is disabled by default with no unattended tools.
- Live claims not represented by exact evidence remain limitations rather than release promises.
