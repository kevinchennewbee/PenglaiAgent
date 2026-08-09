# -*- coding: utf-8 -*-
"""MOSS-TTS-Nano local synthesis integration for Penglai.

Penglai keeps third-party source and model weights outside the repo.  This
module only owns the install/check/synthesize contract used by CLI and Runtime
Hub service events.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time
import urllib.request
import wave
import zipfile

from . import VERSION
from .capabilities import (
    model_base_dir,
    moss_tts_onnx_codec_dir,
    moss_tts_onnx_model_dir,
    moss_tts_onnx_tts_dir,
    moss_tts_repo_dir,
    tts_runtime_status,
)


ROOT = Path(__file__).resolve().parents[1]
MOSS_TTS_REPO_URL = "https://github.com/OpenMOSS/MOSS-TTS-Nano.git"
MOSS_TTS_SOURCE_COMMIT = "cc7bdf19c7639c0870dab22045a33b442760f6be"
MOSS_TTS_SOURCE_ARCHIVE = (
    f"https://codeload.github.com/OpenMOSS/MOSS-TTS-Nano/zip/{MOSS_TTS_SOURCE_COMMIT}",
    14_293_491,
    "b06fd9f7c8f1791b77bc4fedb690d5d53618004d520d1f358e0a590ec0e5a511",
)
MOSS_TTS_BASE_DEPS = (
    "numpy==2.2.6",
    "sentencepiece==0.2.1",
    "onnxruntime==1.23.2",
    "huggingface_hub==0.36.0",
)
MOSS_TTS_TORCH_DEPS = ("torch==2.7.0", "torchaudio==2.7.0")
MOSS_TTS_TORCH_CPU_DEPS = ("torch==2.7.0+cpu", "torchaudio==2.7.0+cpu")
PYTORCH_CPU_INDEX = "https://download.pytorch.org/whl/cpu"
TTS_ONNX_FILES = {
    "browser_poc_manifest.json": (503_354, "097d80e993dc29f0bae427590b4f77084a161cb578b50d82c29f455d5faa9eee"),
    "tts_browser_onnx_meta.json": (4_487, "3edf25232dcd0af3d061c837e9a968a39e2f8592e06777d740503c4f2244f95c"),
    "tokenizer.model": (470_897, "c353ee1479b536bf414c1b247f5542b6607fb8ae91320e5af1781fee200fddff"),
    "moss_tts_decode_step.onnx": (291_483, "698cbc2fc1c2feca16e5895614ed52bbb32ded10f236c076f477b2e69abf32d8"),
    "moss_tts_global_shared.data": (440_813_568, "bce8312c3df6a44545302cae229b61054fe0672e0b252ba59cba47adeed831dc"),
    "moss_tts_local_cached_step.onnx": (53_685, "aa9035fefc1c138a951a8bcfc0374fb03a25f1ece67f7f7f53bce349b84a1dd5"),
    "moss_tts_local_decoder.onnx": (49_231, "51aa754301b38550a5f9adda0ad93bd3dc95819afb511e6dcabf4a90b345a454"),
    "moss_tts_local_fixed_sampled_frame.onnx": (471_262, "40cdb00efc171c450cf91468e01429caa41b0252222cd308e978f58fe354afa8"),
    "moss_tts_local_shared.data": (229_678_080, "bae7782032c0fb12490ab42afe009f87ae6c75a0f0596fc7b5c08e4d5ee93916"),
    "moss_tts_prefill.onnx": (283_305, "d56126dcd0574c2f15d98fc6b35eda68d0386b5bd9c5e38e28548d6f2ea8f3db"),
}
CODEC_ONNX_FILES = {
    "codec_browser_onnx_meta.json": (17_036, "3e291c883bb7d11ff2fe8e964e3e495519760358859f35c951254c7741592731"),
    "moss_audio_tokenizer_decode_full.onnx": (681_902, "0fbbafe3fd4afa2a019af5c5ced204af6e2d1db044fa40f021525d2aee95b4ac"),
    "moss_audio_tokenizer_decode_shared.data": (44_198_912, "e69d52e0f4e84ca27850557ee54face46632d3a5a16c89bd246c7c408466dcad"),
    "moss_audio_tokenizer_decode_step.onnx": (351_400, "9527c86a29e1837edec1f74db57d5eeaadb3a715af3382703566460afed25855"),
    "moss_audio_tokenizer_encode.data": (44_507_136, "aa751265b2bab2887eac224484546b194875aa7494b607115439b3dc6b228a2c"),
    "moss_audio_tokenizer_encode.onnx": (815_775, "eadea4a645abdcf98714c7aead122ee2ce7da6e080f9f80b977cd1ca8e19473a"),
}
MODEL_REPOS = (
    {
        "name": "MOSS-TTS-Nano-100M-ONNX",
        "target": "tts",
        "modelscope": "openmoss/MOSS-TTS-Nano-100M-ONNX",
        "hf": "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX",
        "revision": "f52645cb467506d8e18e746ddd59482685b74e58",
        "files": TTS_ONNX_FILES,
    },
    {
        "name": "MOSS-Audio-Tokenizer-Nano-ONNX",
        "target": "codec",
        "modelscope": "openmoss/MOSS-Audio-Tokenizer-Nano-ONNX",
        "hf": "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX",
        "revision": "ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae",
        "files": CODEC_ONNX_FILES,
    },
)
MODEL_DOWNLOAD_SOURCES = ("modelscope", "hf-mirror", "huggingface")


def venv_python(root: str | os.PathLike[str] | None = None) -> str:
    root_path = Path(root or ROOT)
    py = root_path / ".venv" / "bin" / "python"
    return str(py) if py.exists() else sys.executable


def _run(cmd, *, cwd=None, env=None, timeout=None, stream=False):
    if stream:
        return subprocess.run(cmd, cwd=cwd, env=env, timeout=timeout, text=True)
    return subprocess.run(cmd, cwd=cwd, env=env, timeout=timeout, capture_output=True, text=True)


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _file_matches(path, size, sha256):
    path = Path(path)
    return path.is_file() and path.stat().st_size == size and _sha256(path) == sha256


def _source_file_hashes(root):
    root = Path(root)
    return {
        path.relative_to(root).as_posix(): _sha256(path)
        for path in sorted(root.rglob("*"))
        if path.is_file() and path.name != ".penglai-source.json" and ".git" not in path.parts
    }


def _write_source_receipt(root):
    root = Path(root)
    receipt = {
        "schema": 1,
        "commit": MOSS_TTS_SOURCE_COMMIT,
        "archive_sha256": MOSS_TTS_SOURCE_ARCHIVE[2],
        "files": _source_file_hashes(root),
    }
    (root / ".penglai-source.json").write_text(json.dumps(receipt, sort_keys=True), "utf-8")


def _verified_source_receipt(root):
    try:
        receipt = json.loads((Path(root) / ".penglai-source.json").read_text("utf-8"))
        return (
            receipt.get("schema") == 1
            and receipt.get("commit") == MOSS_TTS_SOURCE_COMMIT
            and receipt.get("archive_sha256") == MOSS_TTS_SOURCE_ARCHIVE[2]
            and receipt.get("files") == _source_file_hashes(root)
        )
    except (OSError, ValueError, TypeError):
        return False


def _verified_source_install(root):
    root = Path(root)
    if (root / ".git").is_dir():
        head = _run(["git", "-C", str(root), "rev-parse", "HEAD"], timeout=30)
        clean = _run(["git", "-C", str(root), "status", "--porcelain", "--untracked-files=all"], timeout=30)
        return (
            head.returncode == 0
            and (head.stdout or "").strip() == MOSS_TTS_SOURCE_COMMIT
            and clean.returncode == 0
            and not (clean.stdout or "").strip()
        )
    return _verified_source_receipt(root)


def _download_file(url, dest, *, expected_size, expected_sha256, stream=False, timeout=60):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "penglai-moss-tts/0.3"})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(part, "wb") as f:
        total = int(resp.headers.get("Content-Length") or 0)
        if total and total != expected_size:
            raise RuntimeError(f"download size mismatch: {total} != {expected_size}")
        got = 0
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            got += len(chunk)
            if got > expected_size:
                raise RuntimeError("download exceeds pinned size")
            if stream:
                if total:
                    print(f"\r  {dest.name}: {got // (1 << 20)}MB / {total // (1 << 20)}MB", end="", flush=True)
                else:
                    print(f"\r  {dest.name}: {got // (1 << 20)}MB", end="", flush=True)
    if stream:
        print()
    if not _file_matches(part, expected_size, expected_sha256):
        raise RuntimeError("download size or SHA-256 mismatch")
    os.replace(part, dest)
    return {"path": str(dest), "bytes": dest.stat().st_size}


def _download_and_extract_source_archive(repo_dir, *, stream=False):
    repo_dir = Path(repo_dir)
    parent = repo_dir.parent
    parent.mkdir(parents=True, exist_ok=True)
    last_error = ""
    url, archive_size, archive_sha256 = MOSS_TTS_SOURCE_ARCHIVE
    zip_path = parent / f"MOSS-TTS-Nano-{MOSS_TTS_SOURCE_COMMIT}.zip"
    tmp_dir = parent / ".MOSS-TTS-Nano-extract"
    try:
        if stream:
            print(f"  下载 MOSS-TTS-Nano 源码包：{url}")
        _download_file(url, zip_path, expected_size=archive_size, expected_sha256=archive_sha256, stream=stream)
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir)
        tmp_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            root = tmp_dir.resolve()
            total_bytes = 0
            infos = zf.infolist()
            if len(infos) > 10_000:
                raise RuntimeError("MOSS-TTS archive has too many entries")
            for info in infos:
                relative = info.filename.replace("\\", "/")
                if relative.startswith("/") or any(part in ("", "..") for part in relative.rstrip("/").split("/")):
                    raise RuntimeError(f"unsafe ZIP path: {info.filename}")
                # Unix symlink mode in the high 16 bits.
                if ((info.external_attr >> 16) & 0o170000) == 0o120000:
                    raise RuntimeError(f"ZIP symlinks are not allowed: {info.filename}")
                total_bytes += max(0, int(info.file_size or 0))
                if total_bytes > 512 * 1024 * 1024:
                    raise RuntimeError("MOSS-TTS archive exceeds 512 MiB expanded")
                destination = (root / relative).resolve()
                if destination != root and root not in destination.parents:
                    raise RuntimeError(f"ZIP path escapes extraction root: {info.filename}")
                if info.is_dir():
                    destination.mkdir(parents=True, exist_ok=True)
                    continue
                destination.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as source, open(destination, "xb") as output:
                    shutil.copyfileobj(source, output)
        source_root = next(
            (p for p in tmp_dir.iterdir() if (p / "infer_onnx.py").is_file()),
            None,
        )
        if source_root is None:
            raise RuntimeError("archive does not contain infer_onnx.py")
        if repo_dir.exists():
            raise RuntimeError(f"refusing to replace existing source directory: {repo_dir}")
        shutil.move(str(source_root), str(repo_dir))
        _write_source_receipt(repo_dir)
        shutil.rmtree(tmp_dir, ignore_errors=True)
        try:
            zip_path.unlink()
        except OSError:
            pass
        return {"ok": True, "repo_dir": str(repo_dir), "source": "archive", "url": url}
    except Exception as exc:
        last_error = str(exc)
        shutil.rmtree(tmp_dir, ignore_errors=True)
        try:
            zip_path.unlink()
        except OSError:
            pass
        if stream:
            print(f"  ⚠️ 源码包下载失败：{last_error[:160]}")
    return {"ok": False, "repo_dir": str(repo_dir), "error": last_error}


def _uv_bin():
    found = shutil.which("uv")
    if found:
        return found
    local = Path.home() / ".local" / "bin" / "uv"
    return str(local) if local.exists() else ""


def ensure_moss_tts_repo(*, base_dir=None, update=False, stream=False, timeout=600):
    repo_dir = Path(moss_tts_repo_dir(base_dir=base_dir))
    repo_dir.parent.mkdir(parents=True, exist_ok=True)
    if (repo_dir / ".git").is_dir():
        head = _run(["git", "-C", str(repo_dir), "rev-parse", "HEAD"], timeout=30)
        if head.returncode != 0 or (head.stdout or "").strip() != MOSS_TTS_SOURCE_COMMIT:
            fetch = _run(["git", "-C", str(repo_dir), "fetch", "--depth", "1", "origin", MOSS_TTS_SOURCE_COMMIT], stream=stream, timeout=timeout)
            if fetch.returncode != 0:
                return {"ok": False, "repo_dir": str(repo_dir), "error": _combined_output(fetch)}
            checkout = _run(["git", "-C", str(repo_dir), "checkout", "--detach", MOSS_TTS_SOURCE_COMMIT], stream=stream, timeout=timeout)
            if checkout.returncode != 0:
                return {"ok": False, "repo_dir": str(repo_dir), "error": _combined_output(checkout)}
        clean = _run(["git", "-C", str(repo_dir), "status", "--porcelain", "--untracked-files=all"], timeout=30)
        if clean.returncode != 0 or (clean.stdout or "").strip():
            return {"ok": False, "repo_dir": str(repo_dir), "error": "pinned MOSS-TTS source checkout has local or untracked changes"}
    elif repo_dir.exists():
        if _verified_source_receipt(repo_dir):
            return {"ok": True, "repo_dir": str(repo_dir), "source": "verified-archive", "commit": MOSS_TTS_SOURCE_COMMIT[:12]}
        return {"ok": False, "repo_dir": str(repo_dir), "error": "existing MOSS-TTS source is not a verified pinned checkout"}
    else:
        res = _run(["git", "clone", "--filter=blob:none", "--no-checkout", MOSS_TTS_REPO_URL, str(repo_dir)], stream=stream, timeout=timeout)
        if res.returncode == 0:
            res = _run(["git", "-C", str(repo_dir), "fetch", "--depth", "1", "origin", MOSS_TTS_SOURCE_COMMIT], stream=stream, timeout=timeout)
        if res.returncode == 0:
            res = _run(["git", "-C", str(repo_dir), "checkout", "--detach", MOSS_TTS_SOURCE_COMMIT], stream=stream, timeout=timeout)
        if res.returncode != 0:
            if repo_dir.exists():
                if repo_dir.is_symlink() or repo_dir.parent.resolve() not in repo_dir.resolve().parents:
                    return {"ok": False, "repo_dir": str(repo_dir), "error": "unsafe partial clone path"}
                shutil.rmtree(repo_dir)
            archive = _download_and_extract_source_archive(repo_dir, stream=stream)
            if not archive.get("ok"):
                return {
                    "ok": False,
                    "repo_dir": str(repo_dir),
                    "error": (_combined_output(res) + "\n" + (archive.get("error") or "")).strip(),
                }
            return archive
    commit = _run(["git", "-C", str(repo_dir), "rev-parse", "--short", "HEAD"], timeout=30)
    return {
        "ok": True,
        "repo_dir": str(repo_dir),
        "source": "git",
        "commit": (commit.stdout or "").strip() if commit.returncode == 0 else "",
    }


def _model_file_url(source, repo, filename):
    if source == "modelscope":
        return f"https://modelscope.cn/models/{repo['modelscope']}/resolve/master/{filename}"
    if source == "hf-mirror":
        return f"https://hf-mirror.com/{repo['hf']}/resolve/{repo['revision']}/{filename}"
    return f"https://huggingface.co/{repo['hf']}/resolve/{repo['revision']}/{filename}"


def _repo_target_dir(repo, *, base_dir=None):
    if repo["target"] == "tts":
        return Path(moss_tts_onnx_tts_dir(base_dir=base_dir))
    return Path(moss_tts_onnx_codec_dir(base_dir=base_dir))


def _all_model_assets_verified(*, base_dir=None):
    return all(
        _file_matches(_repo_target_dir(repo, base_dir=base_dir) / name, *spec)
        for repo in MODEL_REPOS
        for name, spec in repo["files"].items()
    )


def download_moss_tts_onnx_assets(*, base_dir=None, stream=False):
    downloads = []
    skipped = []
    errors = []
    for repo in MODEL_REPOS:
        target = _repo_target_dir(repo, base_dir=base_dir)
        target.mkdir(parents=True, exist_ok=True)
        missing = [name for name, spec in repo["files"].items() if not _file_matches(target / name, *spec)]
        if not missing:
            skipped.append(repo["name"])
            continue
        for source in MODEL_DOWNLOAD_SOURCES:
            source_errors = []
            if stream:
                print(f"  下载 {repo['name']}：{source}")
            for name in list(missing):
                dest = target / name
                spec = repo["files"][name]
                if _file_matches(dest, *spec):
                    missing.remove(name)
                    continue
                try:
                    item = _download_file(
                        _model_file_url(source, repo, name), dest,
                        expected_size=spec[0], expected_sha256=spec[1], stream=stream,
                    )
                    item.update({"repo": repo["name"], "file": name, "source": source})
                    downloads.append(item)
                    missing.remove(name)
                except Exception as exc:
                    source_errors.append(f"{name}: {exc}")
                    try:
                        dest.with_name(dest.name + ".part").unlink()
                    except OSError:
                        pass
                    break
            if not missing:
                break
            if source_errors:
                errors.extend(f"{repo['name']} {source} {err}" for err in source_errors)
                if stream:
                    print(f"  ⚠️ {repo['name']} {source} 下载失败，尝试下一个源")
        if missing:
            return {
                "ok": False,
                "stage": "model_download",
                "repo": repo["name"],
                "missing": missing,
                "downloads": downloads,
                "skipped": skipped,
                "errors": errors,
            }
    final = tts_runtime_status(model_base=base_dir) if base_dir else tts_runtime_status()
    return {
        "ok": _all_model_assets_verified(base_dir=base_dir),
        "stage": "model_download",
        "downloads": downloads,
        "skipped": skipped,
        "errors": errors,
        "status": final,
    }


def install_moss_tts_deps(*, root=None, stream=False, timeout=1800):
    py = venv_python(root)
    uv = _uv_bin()
    if uv:
        base_cmd = [uv, "pip", "install", "--python", py, *MOSS_TTS_BASE_DEPS]
        if platform.system().lower() == "linux":
            torch_cmd = [
                uv,
                "pip",
                "install",
                "--python",
                py,
                "--index-url",
                PYTORCH_CPU_INDEX,
                *MOSS_TTS_TORCH_CPU_DEPS,
            ]
        else:
            torch_cmd = [uv, "pip", "install", "--python", py, *MOSS_TTS_TORCH_DEPS]
    else:
        ensurepip = _run([py, "-m", "ensurepip", "--upgrade"], timeout=120)
        if ensurepip.returncode != 0:
            return {"ok": False, "python": py, "error": _combined_output(ensurepip)}
        base_cmd = [py, "-m", "pip", "install", *MOSS_TTS_BASE_DEPS]
        if platform.system().lower() == "linux":
            torch_cmd = [
                py,
                "-m",
                "pip",
                "install",
                "--index-url",
                PYTORCH_CPU_INDEX,
                *MOSS_TTS_TORCH_CPU_DEPS,
            ]
        else:
            torch_cmd = [py, "-m", "pip", "install", *MOSS_TTS_TORCH_DEPS]
    commands = [base_cmd, torch_cmd]
    for cmd in commands:
        res = _run(cmd, cwd=str(ROOT), stream=stream, timeout=timeout)
        if res.returncode != 0:
            return {
                "ok": False,
                "python": py,
                "cmd": _public_cmd(cmd),
                "commands": [_public_cmd(item) for item in commands],
                "error": _combined_output(res),
            }
    return {"ok": True, "python": py, "commands": [_public_cmd(item) for item in commands], "error": ""}


def _public_cmd(cmd):
    return " ".join(str(part) for part in cmd)


def _combined_output(res):
    return ((getattr(res, "stdout", "") or "") + "\n" + (getattr(res, "stderr", "") or "")).strip()


def choose_default_voice(text):
    """向后兼容：保留原签名和原有默认声音映射。

    原行为：中文 -> Junhao（男声），英文 -> Ava（女声）。
    0.3.5 起，新代码应直接使用 voice_profiles.resolve_voice() 以获得
    性别/persona/显式指定支持。此函数保持单参数签名以兼容现有调用方，
    不应用 persona 推断（避免改变历史默认声音）。
    """
    from .voice_profiles import resolve_voice, _detect_lang, DEFAULT_VOICE
    lang = _detect_lang(text)
    # 保持历史默认：中文男声 Junhao，英文女声 Ava
    historical_default = DEFAULT_VOICE.get((lang, "male"), "Junhao") if lang == "zh" else DEFAULT_VOICE.get((lang, "female"), "Ava")
    return resolve_voice(text, gender="male" if lang == "zh" else "female", persona="butler", explicit_voice=historical_default)


def list_voices(public_only: bool = True):
    """列出可用声音档案（0.3.5 新增）。"""
    from .voice_profiles import list_voice_profiles
    return list_voice_profiles(public_only=public_only)



def _audio_meta(path):
    with wave.open(str(path), "rb") as w:
        frames = w.getnframes()
        rate = w.getframerate()
        channels = w.getnchannels()
        width = w.getsampwidth()
    return {
        "path": str(path),
        "bytes": os.path.getsize(path),
        "sample_rate": rate,
        "channels": channels,
        "sample_width": width,
        "frames": frames,
        "seconds": round(frames / float(rate), 3) if rate else 0,
    }


def synthesize(
    text,
    *,
    output_path=None,
    voice=None,
    cpu_threads=4,
    max_new_frames=160,
    seed=None,
    allow_download=True,
    stream=False,
    timeout=1800,
    base_dir=None,
):
    repo_dir = Path(moss_tts_repo_dir(base_dir=base_dir))
    entrypoint = repo_dir / "infer_onnx.py"
    if not entrypoint.is_file() or not _verified_source_install(repo_dir):
        return {"ok": False, "error": f"MOSS-TTS-Nano repo missing or not pinned/clean: {entrypoint}"}
    st = tts_runtime_status(model_base=base_dir) if base_dir else tts_runtime_status()
    model_ready = _all_model_assets_verified(base_dir=base_dir)
    if not model_ready:
        if not allow_download:
            return {"ok": False, "error": "MOSS-TTS-Nano ONNX assets missing", "status": st}
        assets = download_moss_tts_onnx_assets(base_dir=base_dir, stream=stream)
        if not assets.get("ok"):
            return {"ok": False, "error": "MOSS-TTS-Nano ONNX assets download failed", "assets": assets}
    text = str(text or "").strip()
    if not text:
        return {"ok": False, "error": "text is empty"}
    out = Path(output_path or (ROOT / "temp" / f"moss_tts_{int(time.time())}.wav"))
    out.parent.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["PYTHONPATH"] = str(repo_dir) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    env.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    cmd = [
        venv_python(),
        str(entrypoint),
        "--output-audio-path",
        str(out),
        "--text",
        text,
        "--voice",
        str(voice or choose_default_voice(text)),
        "--execution-provider",
        "cpu",
        "--cpu-threads",
        str(int(cpu_threads)),
        "--max-new-frames",
        str(int(max_new_frames)),
        "--disable-wetext-processing",
        "--model-dir",
        moss_tts_onnx_model_dir(base_dir=base_dir),
    ]
    if seed is not None:
        cmd.extend(["--seed", str(seed)])
    res = _run(cmd, cwd=str(ROOT), env=env, stream=stream, timeout=timeout)
    if res.returncode != 0:
        return {"ok": False, "path": str(out), "cmd": _public_cmd(cmd), "error": _combined_output(res)}
    if not out.is_file() or out.stat().st_size <= 44:
        return {"ok": False, "path": str(out), "cmd": _public_cmd(cmd), "error": "output wav was not created"}
    try:
        meta = _audio_meta(out)
    except Exception as exc:
        return {"ok": False, "path": str(out), "cmd": _public_cmd(cmd), "error": f"invalid wav: {exc}"}
    return {"ok": True, "audio": meta, "cmd": _public_cmd(cmd)}


def run_smoke(*, stream=False, timeout=1800):
    cases = (
        ("zh", "蓬莱本地语音输出测试。", "Junhao", ROOT / "temp" / "moss_tts_smoke_zh.wav", 7),
        ("en", "Penglai local voice output test.", "Ava", ROOT / "temp" / "moss_tts_smoke_en.wav", 11),
    )
    results = []
    for lang, text, voice, output, seed in cases:
        item = synthesize(
            text,
            voice=voice,
            output_path=str(output),
            max_new_frames=120,
            seed=seed,
            stream=stream,
            timeout=timeout,
        )
        item["lang"] = lang
        results.append(item)
        if not item.get("ok"):
            break
    return {"ok": all(item.get("ok") for item in results) and len(results) == len(cases), "results": results}


def ensure_ready(*, stream=False, update_repo=False, run_smoke_check=True):
    repo = ensure_moss_tts_repo(update=update_repo, stream=stream)
    if not repo.get("ok"):
        return {"ok": False, "stage": "repo", "repo": repo, "status": tts_runtime_status()}
    deps = install_moss_tts_deps(stream=stream)
    if not deps.get("ok"):
        return {"ok": False, "stage": "deps", "repo": repo, "deps": deps, "status": tts_runtime_status()}
    assets = download_moss_tts_onnx_assets(stream=stream)
    if not assets.get("ok"):
        return {"ok": False, "stage": "model_download", "repo": repo, "deps": deps, "assets": assets, "status": tts_runtime_status()}
    smoke = run_smoke(stream=stream) if run_smoke_check else {"ok": True, "results": []}
    return {
        "ok": bool(smoke.get("ok")),
        "stage": "smoke" if not smoke.get("ok") else "ready",
        "repo": repo,
        "deps": deps,
        "assets": assets,
        "smoke": smoke,
        "status": tts_runtime_status(),
    }


def smoke_main(argv=None):
    parser = argparse.ArgumentParser(description="MOSS-TTS-Nano 本地语音输出 smoke")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--quiet", action="store_true", help="隐藏上游下载/合成日志")
    args = parser.parse_args(argv)
    result = run_smoke(stream=not args.quiet)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        for item in result["results"]:
            if item.get("ok"):
                a = item["audio"]
                print(f"✅ {item['lang']} {a['path']} {a['sample_rate']}Hz {a['channels']}ch {a['seconds']}s {a['bytes']} bytes")
            else:
                print(f"❌ {item.get('lang', '?')} {item.get('error')}")
    return 0 if result.get("ok") else 1


def say_main(argv=None):
    parser = argparse.ArgumentParser(description="合成一段文字为本地 WAV")
    parser.add_argument("text", nargs="*", help="要合成的文字")
    parser.add_argument("--voice", default="")
    parser.add_argument("--output", default="")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--quiet", action="store_true", help="隐藏上游合成日志")
    args = parser.parse_args(argv)
    text = " ".join(args.text).strip()
    result = synthesize(text, output_path=args.output or None, voice=args.voice or None, stream=not args.quiet)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif result.get("ok"):
        a = result["audio"]
        print(f"✅ 已生成：{a['path']} ({a['sample_rate']}Hz, {a['channels']}ch, {a['seconds']}s)")
        print(f"[FILE:{a['path']}]")
    else:
        print(f"❌ 语音合成失败：{result.get('error')}")
    return 0 if result.get("ok") else 1


def feishu_test_main(argv=None):
    parser = argparse.ArgumentParser(description="合成 MOSS-TTS 音频并通过飞书 owner 真实投递")
    parser.add_argument("text", nargs="*", help="要发送的语音内容")
    parser.add_argument("--voice", default="")
    parser.add_argument("--output", default=str(ROOT / "temp" / "moss_tts_feishu_test.wav"))
    parser.add_argument("--receive-id", default="", help="可选，覆盖 mykey.fs_allowed_users[0]")
    parser.add_argument("--receive-id-type", default="open_id")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--quiet", action="store_true", help="隐藏上游合成日志")
    args = parser.parse_args(argv)
    text = " ".join(args.text).strip() or f"蓬莱 {VERSION} 本地语音输出真实飞书验证。"
    synth = synthesize(text, output_path=args.output, voice=args.voice or None, stream=not args.quiet)
    sent = False
    error = ""
    if synth.get("ok"):
        try:
            from frontends import fsapp
            sent = bool(fsapp.send_local_audio_to_owner(
                synth["audio"]["path"],
                receive_id=args.receive_id or None,
                receive_id_type=args.receive_id_type,
            ))
        except Exception as exc:
            error = str(exc)
    result = {"ok": bool(synth.get("ok") and sent), "synthesis": synth, "feishu_sent": sent, "error": error}
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        if result["ok"]:
            print(f"✅ 已通过飞书发送语音：{synth['audio']['path']}")
        else:
            print(f"❌ 飞书语音验证失败：{error or synth.get('error') or 'send failed'}")
    return 0 if result["ok"] else 1
