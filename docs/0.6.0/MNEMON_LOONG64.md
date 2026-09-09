# Mnemon 0.2.8 linux-loong64 architecture build

Memory is required and default-on on UOS 20. Official GitHub `v0.2.8`
archives cover darwin/windows amd64+arm64 only. This is the same Mnemon
engine, built from the tagged source for old-world LoongArch. It is not
a second memory engine and not a default-off workaround.

Native install/startup/function remain `OWNER_POST_RELEASE`. This record
is source, ELF, and host-test evidence. The binary was not executed on
UOS 20.

## Upstream

| Field | Value |
| --- | --- |
| Repo | https://github.com/mnemon-dev/mnemon |
| Tag | `v0.2.8` |
| Commit | `da9b7da0e3e7f10c84d5f8e9a42e24453c8159bb` |
| License | Apache-2.0 |
| LICENSE SHA-256 | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| Source tarball | https://github.com/mnemon-dev/mnemon/archive/da9b7da0e3e7f10c84d5f8e9a42e24453c8159bb.tar.gz |
| Source tarball SHA-256 | `0da1bcd02f6cee9a15a8a591b5eb9c657e2d454e97ef41cc48534ae144e1244d` |
| SQLite | `modernc.org/sqlite v1.45.0` (pure Go; CGO off) |

Goreleaser does not publish linux/loong64. License permits this
architecture build.

## Builder (not shipped)

| Field | Value |
| --- | --- |
| Go | 1.24.6 (`go.mod` of that commit) |
| Portable tarball | https://go.dev/dl/go1.24.6.darwin-arm64.tar.gz |
| Tarball SHA-256 | `4e29202c49573b953be7cc3500e1f8d9e66ddd12faa8cf0939a4951411e09a2a` |
| CGO | `CGO_ENABLED=0` |
| Target | `GOOS=linux GOARCH=loong64` |
| Flags | `-trimpath -ldflags '-s -w -X github.com/mnemon-dev/mnemon/cmd.version=0.2.8'` |

Recipe: `native/linux-loong64-oldworld/buildscripts/build-mnemon-oldworld.sh`.
Use the hashed portable Go; do not require a global install.

## Product bytes

| Artifact | SHA-256 | Bytes |
| --- | --- | --- |
| `native/linux-loong64-oldworld/artifacts/mnemon` | `a8bc5fc48cbbc60f572dcbb02bf065165837d2134174804820782d2db88bb5be` | 15401144 |
| `mnemon_0.2.8_linux_loong64.tar.gz` | `29474c67d5ed878e055e45103aed188b325e72dece03e92813eb1776dff66fc7` | 6100624 |

ELF (read, not executed): `e_machine=258`, `e_flags=0x0`, `ET_EXEC`,
statically linked, no `PT_INTERP`, no `DT_NEEDED`, no GLIBC, no new-world
loader string, no host paths. Version string `0.2.8` is present.
`native_execution=UNRUN`.

## Host tests (builder, not UOS)

`go test -count=1 ./internal/memory/... ./cmd/memory/... ./cmd/...` on
the pinned source with Go 1.24.6 exited 0 on the builder (2026-09-09).
That is Memory-engine evidence on the builder. It is not UOS native PASS.

## Packaging

`scripts/fetch-mnemon-assets.mjs --target linux-loong64` copies the
artifact into `third_party/mnemon/bin/linux-loong64/`. Pack plugins and
embed-runtime fail closed if the hash drifts. Payload path:
`resources/mnemon/mnemon`.
