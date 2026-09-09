/* PIC shims for names rustc emits that Loongson glibc 2.28 exports only as
 * __xstat64 / __cxa_atexit. libc_nonshared.a uses old-world SOP relocs Zig
 * lld rejects. Loongson bits/stat.h sets _STAT_VER / _STAT_VER_LINUX to 0
 * (kernel shape), not 3 (i386 xstat version). Passing 3 makes __xstat64
 * return EINVAL. atexit is registered via __cxa_atexit(fn, 0, 0): extra
 * NULL arg is ignored on LP64; dso=0 runs at process exit (sharp is
 * process-lifetime). */
int __xstat64(int ver, const char *path, void *buf);
int __fxstat64(int ver, int fd, void *buf);
int __lxstat64(int ver, const char *path, void *buf);
int __fxstatat64(int ver, int dirfd, const char *path, void *buf, int flags);
int __cxa_atexit(void (*func)(void *), void *arg, void *dso);

enum { _STAT_VER_LOONGSON_GLIBC228 = 0 };

int stat64(const char *path, void *buf) {
  return __xstat64(_STAT_VER_LOONGSON_GLIBC228, path, buf);
}
int fstat64(int fd, void *buf) {
  return __fxstat64(_STAT_VER_LOONGSON_GLIBC228, fd, buf);
}
int lstat64(const char *path, void *buf) {
  return __lxstat64(_STAT_VER_LOONGSON_GLIBC228, path, buf);
}
int fstatat64(int dirfd, const char *path, void *buf, int flags) {
  return __fxstatat64(_STAT_VER_LOONGSON_GLIBC228, dirfd, path, buf, flags);
}
int atexit(void (*func)(void)) {
  return __cxa_atexit((void (*)(void *))func, 0, 0);
}
