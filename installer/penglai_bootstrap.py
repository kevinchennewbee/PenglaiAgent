# -*- coding: utf-8 -*-
"""蓬莱引导安装器（PyPI 包 `penglai` 的唯一模块）。

职责只有两个，保持极简：
  1. 本机还没有蓬莱发行版 → 引导：选目录 → git clone 或压缩包下载 → 进向导
  2. 已有发行版 → 把所有参数原样透传给发行版仓库里的 `penglai` 入口脚本

发行版位置的发现顺序：$PENGLAI_HOME → ~/.penglai/home 记录 → 当前目录 → ~/PenglaiAgent。
本模块永不修改发行版内容；升级发行版 = 在仓库里 `penglai update`。
"""
import os
import hashlib
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

CODELOAD = "https://codeload.github.com/kevinchennewbee/PenglaiAgent/tar.gz/refs/tags/v0.3.6"
ARCHIVE_SIZE = 7_131_956
ARCHIVE_SHA256 = "1de546b91a686685e9019dcb9c0fec1f3841f7cf03068bb482b0ee37cd7fba4c"
HOME_RECORD = os.path.expanduser("~/.penglai/home")
DEFAULT_DIR = os.path.expanduser("~/PenglaiAgent")
MAX_ARCHIVE_FILES = 20_000
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024


def _interactive():
    return sys.stdin.isatty() and sys.stdout.isatty()


def _is_distro(path):
    """发行版特征：有 penglai 入口脚本 + GA 内核文件。"""
    return (path and os.path.isfile(os.path.join(path, "penglai"))
            and os.path.isfile(os.path.join(path, "agent_loop.py")))


def _recorded_home():
    try:
        with open(HOME_RECORD, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def find_distro():
    for cand in (os.environ.get("PENGLAI_HOME", ""), _recorded_home(),
                 os.getcwd(), DEFAULT_DIR):
        if _is_distro(cand):
            return cand
    return ""


def _record_home(path):
    directory = os.path.dirname(HOME_RECORD)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    fd = os.open(HOME_RECORD, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(path)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(HOME_RECORD, 0o600)


def _clone(target):
    # The PyPI package is the frozen 0.3.6 bootstrap. Download only that exact
    # signed-release source snapshot and verify its embedded size/SHA-256.
    return _download_archive(target)


def _download_archive(target, proxy=""):
    del proxy  # 0.3.6 bootstrap deliberately has no third-party executable mirror.
    target = os.path.abspath(target)
    if os.path.islink(target) or (os.path.isdir(target) and os.listdir(target)):
        print(f"  ❌ 安装目标不是安全的空目录：{target}")
        return False
    parent = os.path.dirname(target)
    os.makedirs(parent, exist_ok=True)
    staging = tempfile.mkdtemp(prefix=".penglai-036-install-", dir=parent)
    fd, tmp = tempfile.mkstemp(suffix=".tar.gz", prefix="penglai-")
    os.close(fd)
    try:
        for label, url in [("GitHub v0.3.6 codeload 压缩包", CODELOAD)]:
            print(f"  正在下载（{label}）...")
            try:
                with urllib.request.urlopen(url, timeout=90) as resp, open(tmp, "wb") as f:
                    declared = resp.headers.get("Content-Length")
                    if declared and int(declared) > MAX_DOWNLOAD_BYTES:
                        raise RuntimeError("archive download exceeds safe size limit")
                    downloaded = 0
                    while True:
                        chunk = resp.read(1024 * 1024)
                        if not chunk:
                            break
                        downloaded += len(chunk)
                        if downloaded > MAX_DOWNLOAD_BYTES or downloaded > ARCHIVE_SIZE:
                            raise RuntimeError("archive download exceeds safe size limit")
                        f.write(chunk)
                if downloaded != ARCHIVE_SIZE:
                    raise RuntimeError(f"archive size mismatch: {downloaded} != {ARCHIVE_SIZE}")
                digest = hashlib.sha256()
                with open(tmp, "rb") as archive_stream:
                    for chunk in iter(lambda: archive_stream.read(1024 * 1024), b""):
                        digest.update(chunk)
                if digest.hexdigest() != ARCHIVE_SHA256:
                    raise RuntimeError("archive SHA-256 mismatch")
                with tarfile.open(tmp, "r:gz") as tar:
                    target_real = os.path.realpath(staging)
                    files = total_bytes = 0
                    for member in tar.getmembers():
                        parts = member.name.split("/", 1)
                        if len(parts) == 1 or not parts[1]:
                            continue
                        relative = parts[1].replace("\\", "/")
                        if relative.startswith("/") or any(part in ("", "..") for part in relative.split("/")):
                            raise RuntimeError(f"unsafe archive path: {member.name}")
                        if member.issym() or member.islnk() or member.isdev() or not (member.isdir() or member.isfile()):
                            raise RuntimeError(f"unsupported archive member: {member.name}")
                        destination = os.path.realpath(os.path.join(target_real, relative))
                        if destination != target_real and not destination.startswith(target_real + os.sep):
                            raise RuntimeError(f"archive path escapes target: {member.name}")
                        files += 1
                        total_bytes += max(0, int(member.size or 0))
                        if files > MAX_ARCHIVE_FILES or total_bytes > MAX_ARCHIVE_BYTES:
                            raise RuntimeError("archive exceeds safe extraction limits")
                        if member.isdir():
                            os.makedirs(destination, exist_ok=True)
                            continue
                        os.makedirs(os.path.dirname(destination), exist_ok=True)
                        source = tar.extractfile(member)
                        if source is None:
                            raise RuntimeError(f"cannot read archive member: {member.name}")
                        with source, open(destination, "xb") as output:
                            shutil.copyfileobj(source, output)
                if not _is_distro(staging):
                    raise RuntimeError("verified archive is missing the 0.3.6 distribution entrypoints")
                if os.path.isdir(target):
                    os.rmdir(target)
                os.replace(staging, target)
                staging = ""
                return True
            except Exception as exc:
                print(f"  ❌ {label} 失败：{exc}")
        return False
    finally:
        if staging and os.path.isdir(staging) and not os.path.islink(staging):
            shutil.rmtree(staging, ignore_errors=True)
        try:
            os.remove(tmp)
        except OSError:
            pass


def install():
    print("🏮 蓬莱 · Penglai — 住在飞书、微信和终端里的中文 AI 管家\n")
    if not _interactive():
        print("❌ 安装向导需要交互终端。请在终端直接运行 `penglai`，或设置 PENGLAI_HOME 指向已安装目录。")
        return 1
    target = input(f"安装目录 [{DEFAULT_DIR}]: ").strip() or DEFAULT_DIR
    target = os.path.abspath(os.path.expanduser(target))
    if _is_distro(target):
        print("✅ 该目录已是蓬莱发行版，直接进入向导。")
    elif os.path.isdir(target) and os.listdir(target):
        print(f"❌ 目录 {target} 非空且不是蓬莱发行版，换个目录再来。")
        return 1
    elif not _clone(target):
        return 1
    _record_home(target)
    print(f"\n✅ 发行版就绪：{target}\n   进入安装向导（依赖 → 模型 → 飞书 → 可选微信扫码）...\n")
    if not _interactive():
        print("❌ 安装向导需要交互终端。请进入安装目录后运行 `python3 penglai setup`。")
        return 1
    return subprocess.run([sys.executable, os.path.join(target, "penglai"), "setup"],
                          cwd=target).returncode


def main():
    args = sys.argv[1:]
    distro = find_distro()
    if distro:
        sys.exit(subprocess.run(
            [sys.executable, os.path.join(distro, "penglai")] + args, cwd=distro).returncode)
    if not args or args[0] in ("setup", "install"):
        sys.exit(install())
    print("尚未安装蓬莱发行版。直接运行 `penglai` 开始引导安装。")
    sys.exit(1)


if __name__ == "__main__":
    main()
