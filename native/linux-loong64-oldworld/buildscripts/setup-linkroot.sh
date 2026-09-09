#!/bin/bash
# Rewrite gcc 8.3 old-world sysroot linker scripts so Zig does not use
# absolute /lib64 paths or the new-world ld-linux-loongarch-lp64d.so.1 loader.
set -euo pipefail
# shellcheck source=env.sh
source "$(dirname "$0")/env.sh"

if [[ ! -f "$SYSROOT/lib64/libc-2.28.so" ]]; then
  echo "missing old-world libc-2.28 at $SYSROOT/lib64/libc-2.28.so" >&2
  exit 1
fi

mkdir -p "$LINKROOT/lib64" "$LINKROOT/usr/lib64"
cp -f "$SYSROOT/lib64/libc-2.28.so" "$LINKROOT/lib64/libc.so.6"
cp -f "$SYSROOT/lib64/ld-2.28.so" "$LINKROOT/lib64/ld.so.1"
# Duplicate into usr/lib64 so the relative GROUP() script resolves.
cp -f "$SYSROOT/lib64/libc-2.28.so" "$LINKROOT/usr/lib64/libc.so.6"
cp -f "$SYSROOT/lib64/ld-2.28.so" "$LINKROOT/usr/lib64/ld.so.1"
cp -f "$SYSROOT/usr/lib64/libc_nonshared.a" "$LINKROOT/usr/lib64/libc_nonshared.a"
for name in crti.o crtn.o crt1.o Scrt1.o; do
  cp -f "$SYSROOT/usr/lib64/$name" "$LINKROOT/usr/lib64/$name"
  cp -f "$SYSROOT/lib64/$name" "$LINKROOT/lib64/$name" 2>/dev/null || true
done
# Relative GROUP: never absolute /lib64 (Zig default new-world loader).
cat > "$LINKROOT/usr/lib64/libc.so" <<'EOF'
OUTPUT_FORMAT(elf64-loongarch)
GROUP ( libc.so.6 libc_nonshared.a AS_NEEDED ( ld.so.1 ) )
EOF
cp -f "$LINKROOT/usr/lib64/libc.so" "$LINKROOT/lib64/libc.so"
# Real ELF shared objects (not absolute-path linker scripts) under both lib dirs
# so -lm / -lpthread / -ldl resolve without /lib64 GROUP() scripts.
copy_so() {
  local src="$1" destname="$2" linkname="$3"
  cp -f "$src" "$LINKROOT/lib64/$destname"
  cp -f "$src" "$LINKROOT/usr/lib64/$destname"
  ln -sfn "$destname" "$LINKROOT/lib64/$linkname"
  ln -sfn "$destname" "$LINKROOT/usr/lib64/$linkname"
}
copy_so "$SYSROOT/lib64/libm-2.28.so" libm.so.6 libm.so
copy_so "$SYSROOT/lib64/libdl-2.28.so" libdl.so.2 libdl.so
copy_so "$SYSROOT/lib64/libpthread-2.28.so" libpthread.so.0 libpthread.so
copy_so "$SYSROOT/lib64/librt-2.28.so" librt.so.1 librt.so
copy_so "$SYSROOT/lib64/libutil-2.28.so" libutil.so.1 libutil.so
copy_so "$SYSROOT/lib64/libresolv-2.28.so" libresolv.so.2 libresolv.so
if [[ -e "$SYSROOT/usr/lib64/libatomic.so.1.2.0" ]]; then
  copy_so "$SYSROOT/usr/lib64/libatomic.so.1.2.0" libatomic.so.1 libatomic.so
fi
cp -f "$SYSROOT/usr/lib64/libstdc++.so.6.0.25" "$LINKROOT/usr/lib64/libstdc++.so.6"
cp -f "$SYSROOT/usr/lib64/libstdc++.so.6.0.25" "$LINKROOT/lib64/libstdc++.so.6"
ln -sfn libstdc++.so.6 "$LINKROOT/usr/lib64/libstdc++.so"
ln -sfn libstdc++.so.6 "$LINKROOT/lib64/libstdc++.so"
cp -f "$SYSROOT/usr/lib64/libgcc_s.so.1" "$LINKROOT/usr/lib64/libgcc_s.so.1"
cp -f "$SYSROOT/usr/lib64/libgcc_s.so.1" "$LINKROOT/lib64/libgcc_s.so.1"
cat > "$LINKROOT/usr/lib64/libgcc_s.so" <<'EOF'
GROUP ( libgcc_s.so.1 libgcc.a )
EOF
cp -f "$LINKROOT/usr/lib64/libgcc_s.so" "$LINKROOT/lib64/libgcc_s.so"
# gcc crtbegin/crtend for shared objects
cp -f "$GCCLIB/crtbeginS.o" "$LINKROOT/usr/lib64/crtbeginS.o"
cp -f "$GCCLIB/crtendS.o" "$LINKROOT/usr/lib64/crtendS.o"
cp -f "$GCCLIB/crtbegin.o" "$LINKROOT/usr/lib64/crtbegin.o"
cp -f "$GCCLIB/crtend.o" "$LINKROOT/usr/lib64/crtend.o"
cp -f "$GCCLIB/libgcc.a" "$LINKROOT/usr/lib64/libgcc.a"
cp -f "$GCCLIB/libgcc_eh.a" "$LINKROOT/usr/lib64/libgcc_eh.a"

cat > "$WORK/work/libc.txt" <<EOF
include_dir=${SYSROOT}/usr/include
sys_include_dir=${SYSROOT}/usr/include
crt_dir=${LINKROOT}/usr/lib64
msvc_lib_dir=
kernel32_lib_dir=
gcc_dir=${LINKROOT}/usr/lib64
EOF

echo "linkroot ready at $LINKROOT"
