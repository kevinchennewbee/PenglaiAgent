# Penglai 0.6.1 UOS 20 remaining native evidence

Target remains UnionTech UOS 20 Professional 1070, `linux-loong64`, old-world
userland, kernel 4.19. Not V25 and not another architecture.

The 0.6.0 `OWNER_POST_RELEASE` record is historical. It is not a 0.6.1 native
PASS and is not a blanket future exception.

## Source work in this phase

- Closure credential records Node **22.16.0** on linux-loong64, matching the
  payload interpreter, not generic 22.23.2.
- Debian `Depends` includes `libatomic1` because the vendor Node ELF links
  `libatomic.so.1`.
- `Recommends: bubblewrap`. DSH tries `bwrap` then Landlock. This kernel is
  4.19; mainline Landlock arrived at 5.13. Missing sandbox is
  `SANDBOX_UNAVAILABLE`, not a window obtained with `--no-sandbox`.
- chrome-sandbox stays setuid in the payload. It is not DSH bwrap.

## Remaining native evidence (manager adjudication)

1. Install the later frozen-main `Penglai_0.6.1_uos_loong64.deb` on the selected
   UOS 20 host after checking size and SHA-256.
2. Record `dpkg --print-architecture`, glibc, and `/lib64/ld.so.1`.
3. Install without ignoring dependencies. If `libatomic1` or `bubblewrap` is
   missing, install the declared package or record the exact missing soname.
4. First open: desktop, DSH, Office, and Memory ready. Keep the first loader,
   libatomic, native-module, or sandbox error if the window fails.
5. One real-model conversation, one restricted tool task, one Office file, one
   Memory write that survives restart.
6. Do not use `--no-sandbox`, disable Office/Memory, or unconstrained execution
   to obtain PASS.

Until those host steps exist, UOS native install/startup/function stays
`OWNER_POST_RELEASE` / `NOT_RUN`.
