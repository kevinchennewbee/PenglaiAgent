# -*- coding: utf-8 -*-
"""蓬莱引导安装器（PyPI 包 `penglai` 的唯一模块）。

职责只有两个，保持极简：
  1. 本机还没有蓬莱发行版 → 引导：选目录 → git clone（GitHub 失败自动走 gh-proxy 镜像）→ 进向导
  2. 已有发行版 → 把所有参数原样透传给发行版仓库里的 `penglai` 入口脚本

发行版位置的发现顺序：$PENGLAI_HOME → ~/.penglai/home 记录 → 当前目录 → ~/PenglaiAgent。
本模块永不修改发行版内容；升级发行版 = 在仓库里 `penglai update`。
"""
import os
import shutil
import subprocess
import sys

REPO = "https://github.com/kevinchennewbee/PenglaiAgent.git"
MIRROR = "https://gh-proxy.com/" + REPO
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
    for i, url in enumerate((REPO, MIRROR)):
        label = "GitHub 直连" if i == 0 else "gh-proxy 镜像（国内网络）"
        print(f"  正在克隆（{label}）...")
        r = subprocess.run(["git", "clone", "--depth", "1", url, target])
        if r.returncode == 0:
            return True
        print(f"  ❌ {label} 失败，" + ("尝试镜像..." if i == 0 else "请检查网络后重试。"))
    return False


def install():
    print("🏮 蓬莱 · Penglai — 住在你飞书和微信里的中文 AI 管家\n")
    if not shutil.which("git"):
        print("❌ 需要 git。请先安装：apt install git / brew install git")
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
