# -*- coding: utf-8 -*-
"""MOSS-TTS-Nano local synthesis integration for Penglai.

Penglai keeps third-party source and model weights outside the repo.  This
module only owns the install/check/synthesize contract used by CLI and Runtime
Hub service events.
"""

from __future__ import annotations

import argparse
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
MOSS_TTS_SOURCE_ARCHIVES = (
    "https://gh-proxy.com/https://github.com/OpenMOSS/MOSS-TTS-Nano/archive/refs/heads/main.zip",
    "https://github.com/OpenMOSS/MOSS-TTS-Nano/archive/refs/heads/main.zip",
)
MOSS_TTS_BASE_DEPS = (
    "numpy",
    "sentencepiece",
    "onnxruntime",
    "huggingface_hub",
)
MOSS_TTS_TORCH_DEPS = ("torch==2.7.0", "torchaudio==2.7.0")
MOSS_TTS_TORCH_CPU_DEPS = ("torch==2.7.0+cpu", "torchaudio==2.7.0+cpu")
PYTORCH_CPU_INDEX = "https://download.pytorch.org/whl/cpu"
TTS_ONNX_FILES = (
    "browser_poc_manifest.json",
    "tts_browser_onnx_meta.json",
    "tokenizer.model",
    "moss_tts_decode_step.onnx",
    "moss_tts_global_shared.data",
    "moss_tts_local_cached_step.onnx",
    "moss_tts_local_decoder.onnx",
    "moss_tts_local_fixed_sampled_frame.onnx",
    "moss_tts_local_shared.data",
    "moss_tts_prefill.onnx",
)
CODEC_ONNX_FILES = (
    "codec_browser_onnx_meta.json",
    "moss_audio_tokenizer_decode_full.onnx",
    "moss_audio_tokenizer_decode_shared.data",
    "moss_audio_tokenizer_decode_step.onnx",
    "moss_audio_tokenizer_encode.data",
    "moss_audio_tokenizer_encode.onnx",
)
MODEL_REPOS = (
    {
        "name": "MOSS-TTS-Nano-100M-ONNX",
        "target": "tts",
        "modelscope": "openmoss/MOSS-TTS-Nano-100M-ONNX",
        "hf": "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX",
        "files": TTS_ONNX_FILES,
    },
    {
        "name": "MOSS-Audio-Tokenizer-Nano-ONNX",
        "target": "codec",
        "modelscope": "openmoss/MOSS-Audio-Tokenizer-Nano-ONNX",
        "hf": "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX",
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


def _download_file(url, dest, *, stream=False, timeout=60):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "penglai-moss-tts/0.3"})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(part, "wb") as f:
        total = int(resp.headers.get("Content-Length") or 0)
        got = 0
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            got += len(chunk)
            if stream:
                if total:
                    print(f"\r  {dest.name}: {got // (1 << 20)}MB / {total // (1 << 20)}MB", end="", flush=True)
                else:
                    print(f"\r  {dest.name}: {got // (1 << 20)}MB", end="", flush=True)
    if stream:
        print()
    os.replace(part, dest)
    return {"path": str(dest), "bytes": dest.stat().st_size}


def _download_and_extract_source_archive(repo_dir, *, stream=False):
    repo_dir = Path(repo_dir)
    parent = repo_dir.parent
    parent.mkdir(parents=True, exist_ok=True)
    last_error = ""
    for url in MOSS_TTS_SOURCE_ARCHIVES:
        zip_path = parent / "MOSS-TTS-Nano-main.zip"
        tmp_dir = parent / ".MOSS-TTS-Nano-extract"
        try:
            if stream:
                print(f"  下载 MOSS-TTS-Nano 源码包：{url}")
            _download_file(url, zip_path, stream=stream)
            if tmp_dir.exists():
                shutil.rmtree(tmp_dir)
            tmp_dir.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(tmp_dir)
            source_root = next(
                (p for p in tmp_dir.iterdir() if (p / "infer_onnx.py").is_file()),
                None,
            )
            if source_root is None:
                raise RuntimeError("archive does not contain infer_onnx.py")
            if repo_dir.exists():
                shutil.rmtree(repo_dir)
            shutil.move(str(source_root), str(repo_dir))
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
        if update:
            res = _run(["git", "-C", str(repo_dir), "pull", "--ff-only"], stream=stream, timeout=timeout)
            if res.returncode != 0:
                return {"ok": False, "repo_dir": str(repo_dir), "error": _combined_output(res)}
    elif (repo_dir / "infer_onnx.py").is_file() and (repo_dir / "onnx_tts_runtime.py").is_file() and not update:
        return {"ok": True, "repo_dir": str(repo_dir), "source": "existing"}
    else:
        res = _run(["git", "clone", "--depth", "1", MOSS_TTS_REPO_URL, str(repo_dir)], stream=stream, timeout=timeout)
        if res.returncode != 0:
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
        return f"https://hf-mirror.com/{repo['hf']}/resolve/main/{filename}"
    return f"https://huggingface.co/{repo['hf']}/resolve/main/{filename}"


def _repo_target_dir(repo, *, base_dir=None):
    if repo["target"] == "tts":
        return Path(moss_tts_onnx_tts_dir(base_dir=base_dir))
    return Path(moss_tts_onnx_codec_dir(base_dir=base_dir))


def download_moss_tts_onnx_assets(*, base_dir=None, stream=False):
    downloads = []
    skipped = []
    errors = []
    for repo in MODEL_REPOS:
        target = _repo_target_dir(repo, base_dir=base_dir)
        target.mkdir(parents=True, exist_ok=True)
        missing = [name for name in repo["files"] if not (target / name).is_file()]
        if not missing:
            skipped.append(repo["name"])
            continue
        for source in MODEL_DOWNLOAD_SOURCES:
            source_errors = []
            if stream:
                print(f"  下载 {repo['name']}：{source}")
            for name in list(missing):
                dest = target / name
                if dest.is_file() and dest.stat().st_size > 0:
                    missing.remove(name)
                    continue
                try:
                    item = _download_file(_model_file_url(source, repo, name), dest, stream=stream)
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
        "ok": final["components"].get("moss_tts_onnx_model") and final["components"].get("moss_audio_tokenizer_onnx"),
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
    raw = str(text or "")
    if any("\u3400" <= ch <= "\u9fff" for ch in raw):
        return "Junhao"
    return "Ava"


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
    if not entrypoint.is_file():
        return {"ok": False, "error": f"MOSS-TTS-Nano repo missing: {entrypoint}"}
    st = tts_runtime_status(model_base=base_dir) if base_dir else tts_runtime_status()
    model_ready = st["components"].get("moss_tts_onnx_model") and st["components"].get("moss_audio_tokenizer_onnx")
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
