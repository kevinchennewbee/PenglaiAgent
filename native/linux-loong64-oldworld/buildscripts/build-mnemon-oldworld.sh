#!/bin/bash
# Architecture-build official Mnemon 0.2.8 for UOS 20 old-world linux-loong64.
# CGO is off. Output is a static LoongArch ELF. Native execution is UNRUN.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/native/linux-loong64-oldworld/artifacts}"
WORK="${WORK:-/tmp/penglai-mnemon-oldworld-build}"
SRC_TGZ="${SRC_TGZ:-}"
GO_BIN="${GO_BIN:-}"

MNEMON_COMMIT="da9b7da0e3e7f10c84d5f8e9a42e24453c8159bb"
MNEMON_VERSION="0.2.8"
SRC_SHA="0da1bcd02f6cee9a15a8a591b5eb9c657e2d454e97ef41cc48534ae144e1244d"
LICENSE_SHA="c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4"
BINARY_SHA="a8bc5fc48cbbc60f572dcbb02bf065165837d2134174804820782d2db88bb5be"
ARCHIVE_SHA="29474c67d5ed878e055e45103aed188b325e72dece03e92813eb1776dff66fc7"
SRC_URL="https://github.com/mnemon-dev/mnemon/archive/${MNEMON_COMMIT}.tar.gz"

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

if [[ -z "$GO_BIN" ]]; then
  if command -v go >/dev/null 2>&1; then
    GO_BIN="$(command -v go)"
  else
    echo "set GO_BIN to portable Go 1.24.6 (see docs/0.6.0/MNEMON_LOONG64.md)" >&2
    exit 2
  fi
fi
GO_VERSION="$("$GO_BIN" env GOVERSION)"
if [[ "$GO_VERSION" != "go1.24.6" ]]; then
  echo "Mnemon loong64 build requires Go 1.24.6, got $GO_VERSION" >&2
  exit 2
fi

mkdir -p "$WORK/src" "$OUT_DIR"
if [[ -z "$SRC_TGZ" ]]; then
  SRC_TGZ="$WORK/mnemon-${MNEMON_COMMIT}.tar.gz"
  if [[ ! -f "$SRC_TGZ" ]] || [[ "$(sha256_file "$SRC_TGZ")" != "$SRC_SHA" ]]; then
    curl -fsSL "$SRC_URL" -o "$SRC_TGZ"
  fi
fi
if [[ "$(sha256_file "$SRC_TGZ")" != "$SRC_SHA" ]]; then
  echo "Mnemon source tarball hash mismatch" >&2
  exit 1
fi

rm -rf "$WORK/src/mnemon"
mkdir -p "$WORK/src"
tar -xzf "$SRC_TGZ" -C "$WORK/src"
SRC_DIR="$WORK/src/mnemon-${MNEMON_COMMIT}"
test -f "$SRC_DIR/go.mod"
if [[ "$(sha256_file "$SRC_DIR/LICENSE")" != "$LICENSE_SHA" ]]; then
  echo "Mnemon LICENSE hash mismatch" >&2
  exit 1
fi

(
  cd "$SRC_DIR"
  CGO_ENABLED=0 GOOS=linux GOARCH=loong64 "$GO_BIN" build \
    -trimpath \
    -ldflags "-s -w -X github.com/mnemon-dev/mnemon/cmd.version=${MNEMON_VERSION}" \
    -o "$OUT_DIR/mnemon" \
    .
)

chmod 755 "$OUT_DIR/mnemon"
if [[ "$(sha256_file "$OUT_DIR/mnemon")" != "$BINARY_SHA" ]]; then
  echo "built mnemon hash is not the pinned linux-loong64 identity; record a new pin only after review" >&2
  echo "got $(sha256_file "$OUT_DIR/mnemon")" >&2
  exit 1
fi

COPYFILE_DISABLE=1 tar -czf "$OUT_DIR/mnemon_${MNEMON_VERSION}_linux_loong64.tar.gz" \
  -C "$OUT_DIR" mnemon
ARCHIVE_GOT="$(sha256_file "$OUT_DIR/mnemon_${MNEMON_VERSION}_linux_loong64.tar.gz")"
if [[ "$ARCHIVE_GOT" != "$ARCHIVE_SHA" ]]; then
  echo "warning: tar headers are not the committed archive pin $ARCHIVE_SHA (got $ARCHIVE_GOT)" >&2
  echo "the product pin is the ELF binary $BINARY_SHA" >&2
fi

echo "mnemon linux-loong64 architecture build pinned at $BINARY_SHA"
