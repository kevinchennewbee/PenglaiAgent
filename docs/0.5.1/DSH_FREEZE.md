# DSH 0.1.1-rc.1 freeze (2026-08-21)

Do not follow npm dist-tags. `latest` is still `0.1.0-rc.7`; `next` currently points at `0.1.1-rc.1`.

## Live evidence captured this pass

| Field | Value |
| --- | --- |
| npm version | `0.1.1-rc.1` |
| npm integrity | `sha512-HVauMT0F7MWUctkxzBcu5PMFc8j0lm0kX+4IbcUsA7Oh+/xv7xhigEDP0SaSOM/kR48U/BldHbZru116DcZz0w==` |
| npm shasum | `aa9953e6b9ae3f09dc28d6520510909108314566` |
| GitHub tag | `dsh-v0.1.1-rc.1` |
| tag commit | `528c682e061696f5a160f363f236ecbf53cbd006` |
| master merge | `Merge pull request #2890 from deepseek-harness/release/dsh-0.1.1-rc.1` |
| GitHub Release page | `https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.1` HTTP 200 |

All 13 Penglai direct DSH packages exist at exact `0.1.1-rc.1` on npm. Integrity for each is recorded in the lockfile after the dependency-migration commit.

## Rule

`packages/release-identity/src/pins.ts` is the only source of `PINNED_DSH`, `PINNED_DSH_COMMIT`, `PINNED_DSH_INTEGRITY`, and `RELEASE_TARGETS`. Scripts and contracts must import those values.
