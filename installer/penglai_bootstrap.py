# -*- coding: utf-8 -*-
"""蓬莱引导安装器（PyPI 包 `penglai` 的唯一模块）。

职责只有两个，保持极简：
  1. 本机还没有蓬莱发行版 → 引导：选目录 → git clone 或压缩包下载 → 进向导
  2. 已有发行版 → 把所有参数原样透传给发行版仓库里的 `penglai` 入口脚本

发行版位置的发现顺序：$PENGLAI_HOME → ~/.penglai/home 记录 → 当前目录 → ~/PenglaiAgent。
本模块永不修改发行版内容；升级发行版 = 在仓库里 `penglai update`。
"""
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

REPO = "https://github.com/kevinchennewbee/PenglaiAgent.git"
ARCHIVE = "https://github.com/kevinchennewbee/PenglaiAgent/archive/refs/heads/main.tar.gz"
CODELOAD = "https://codeload.github.com/kevinchennewbee/PenglaiAgent/tar.gz/refs/heads/main"
HOME_RECORD = os.path.expanduser("~/.penglai/home")
DEFAULT_DIR = os.path.expanduser("~/PenglaiAgent")


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
    os.makedirs(os.path.dirname(HOME_RECORD), exist_ok=True)
    with open(HOME_RECORD, "w", encoding="utf-8") as f:
        f.write(path)


def _clone(target):
    proxy = os.environ.get("PENGLAI_GH_PROXY", "https://gh-proxy.com/")
    if proxy and not proxy.endswith("/"):
        proxy += "/"
    candidates = [("GitHub 直连", REPO)]
    if proxy:
        candidates.append(("GitHub 镜像（国内网络）", proxy + REPO))
    if not shutil.which("git"):
        print("  未检测到 git，改用压缩包下载...")
        return _download_archive(target, proxy)
    for i, (label, url) in enumerate(candidates):
        print(f"  正在克隆（{label}）...")
        try:
            r = subprocess.run(["git", "clone", "--depth", "1", url, target], timeout=90)
        except subprocess.TimeoutExpired:
            r = subprocess.CompletedProcess(["git", "clone"], 124)
        if r.returncode == 0:
            return True
        if os.path.exists(target) and not _is_distro(target):
            shutil.rmtree(target, ignore_errors=True)
        more = "尝试镜像..." if i == 0 and len(candidates) > 1 else "请检查网络后重试。"
        print(f"  ❌ {label} 失败，{more}")
    print("  Git 克隆失败，改用压缩包下载...")
    return _download_archive(target, proxy)


def _download_archive(target, proxy=""):
    urls = []
    if proxy:
        urls.append(("GitHub 镜像压缩包", proxy + ARCHIVE))
    urls.extend([
        ("GitHub codeload 压缩包", CODELOAD),
        ("GitHub 压缩包", ARCHIVE),
    ])
    fd, tmp = tempfile.mkstemp(suffix=".tar.gz", prefix="penglai-")
    os.close(fd)
    try:
        for label, url in urls:
            print(f"  正在下载（{label}）...")
            try:
                with urllib.request.urlopen(url, timeout=90) as resp, open(tmp, "wb") as f:
                    shutil.copyfileobj(resp, f)
                os.makedirs(target, exist_ok=True)
                with tarfile.open(tmp, "r:gz") as tar:
                    root = ""
                    for member in tar.getmembers():
                        parts = member.name.split("/", 1)
                        if len(parts) == 1:
                            root = parts[0]
                            continue
                        member.name = parts[1]
                        tar.extract(member, target)
                    _ = root
                return _is_distro(target)
            except Exception as exc:
                if os.path.exists(target) and not _is_distro(target):
                    shutil.rmtree(target, ignore_errors=True)
                print(f"  ❌ {label} 失败：{exc}")
        return False
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def install():
    print("🏮 蓬莱 · Penglai — 住在飞书、微信和终端里的中文 AI 管家\n")
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
