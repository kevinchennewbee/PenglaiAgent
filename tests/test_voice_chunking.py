# -*- coding: utf-8 -*-
import array
import os
import tempfile
import types

from _harness import Resp, install_fakes, fresh_import, run_gen


def test_transcribe_file_decodes_pcm_in_chunks():
    install_fakes()
    pv = fresh_import("plugins.penglai_voice")
    tmp = tempfile.mkdtemp()
    model_dir = os.path.join(tmp, "model")
    os.makedirs(model_dir, exist_ok=True)
    open(os.path.join(model_dir, "model.int8.onnx"), "w").write("x")
    open(os.path.join(model_dir, "tokens.txt"), "w").write("x")
    audio = os.path.join(tmp, "a.wav")
    open(audio, "wb").write(b"x")

    samples = array.array("f", [0.1] * 160000).tobytes()  # 10 sec @ 16k
    calls = {"decode": 0}

    class _Stdout:
        def __init__(self, data):
            self.data = data
            self.pos = 0
        def read(self, n):
            if self.pos >= len(self.data):
                return b""
            out = self.data[self.pos:self.pos + n]
            self.pos += len(out)
            return out

    class _Stderr:
        def read(self):
            return b""

    class _Popen:
        def __init__(self, *a, **k):
            self.stdout = _Stdout(samples)
            self.stderr = _Stderr()
        def wait(self):
            return 0

    class _Rec:
        def create_stream(self):
            return types.SimpleNamespace(result=None, accept_waveform=lambda sr, data: None)
        def decode_stream(self, stream):
            calls["decode"] += 1
            stream.result = types.SimpleNamespace(
                text=f"part{calls['decode']}",
                emotion="<|NEUTRAL|>",
                event="",
                lang="<|zh|>",
            )

    old_model, old_chunk = pv.MODEL_DIR, pv._CHUNK_SEC
    old_popen = pv.subprocess.Popen
    old_ffmpeg = pv._ffmpeg_bin
    old_rec = pv._get_recognizer
    try:
        pv.MODEL_DIR = model_dir
        pv._CHUNK_SEC = 1
        pv._ffmpeg_bin = lambda: "ffmpeg"
        pv._get_recognizer = lambda: _Rec()
        pv.subprocess.Popen = _Popen
        res = pv.transcribe_file(audio)
        assert res["duration_sec"] == 10.0
        assert calls["decode"] == 2, calls
        assert res["text"] == "part1 part2"
    finally:
        pv.MODEL_DIR = old_model
        pv._CHUNK_SEC = old_chunk
        pv.subprocess.Popen = old_popen
        pv._ffmpeg_bin = old_ffmpeg
        pv._get_recognizer = old_rec


def test_transcribe_missing_model_finishes_without_download_command():
    ga = install_fakes()
    pv = fresh_import("plugins.penglai_voice")
    tmp = tempfile.mkdtemp()
    audio = os.path.join(tmp, "a.wav")
    open(audio, "wb").write(b"x")
    old_model = pv.MODEL_DIR
    try:
        pv.MODEL_DIR = os.path.join(tmp, "missing-model")
        res = pv.transcribe_file(audio)
        assert "error" in res
        assert "curl" not in res["error"]
        assert "tar " not in res["error"]
        assert res.get("fatal") is True

        handler = ga.GenericAgentHandler(cwd=tmp)
        outs, outcome = run_gen(handler.do_transcribe({"path": audio}, Resp()))
        assert outcome.next_prompt is None
        assert "不会自动下载或安装" in outcome.data
        assert not any("curl" in out or "tar " in out for out in outs)
    finally:
        pv.MODEL_DIR = old_model


if __name__ == "__main__":
    test_transcribe_file_decodes_pcm_in_chunks()
    test_transcribe_missing_model_finishes_without_download_command()
    print("PASS test_voice_chunking")
