# -*- coding: utf-8 -*-
"""共享 artifact 解析：真实文件外发，占位符/示例静默忽略。"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import run_tests

from plugins import penglai_artifacts as art


def test_placeholder_marker_is_ignored_not_missing():
    items = art.classify_file_markers("说明旧机制 `[FILE:...]`，不要外发。")
    assert len(items) == 1
    assert items[0].status == "ignored"


def test_real_pdf_and_md_are_allowed_from_any_directory():
    td = tempfile.mkdtemp()
    pdf = os.path.join(td, "report.pdf")
    md = os.path.join(td, "notes.md")
    open(pdf, "wb").write(b"%PDF")
    open(md, "w", encoding="utf-8").write("# notes")
    items = art.classify_file_markers(f"[FILE:{pdf}]\n[FILE:notes.md]", base_dir=td)
    allowed = [x.realpath for x in items if x.status == "allowed"]
    assert allowed == [os.path.realpath(pdf), os.path.realpath(md)]


def test_sensitive_suffix_is_blocked_but_txt_is_allowed():
    td = tempfile.mkdtemp()
    py = os.path.join(td, "script.py")
    txt = os.path.join(td, "api_token.txt")
    open(py, "w").write("print(1)")
    open(txt, "w").write("token")
    items = art.classify_file_markers(f"[FILE:{py}]\n[FILE:{txt}]")
    assert [x.status for x in items] == ["blocked", "allowed"]
    assert "敏感后缀" in items[0].reason


def test_missing_real_path_is_reported():
    td = tempfile.mkdtemp()
    missing = os.path.join(td, "missing.png")
    items = art.classify_file_markers(f"[FILE:{missing}]")
    assert len(items) == 1
    assert items[0].status == "missing"
    assert items[0].reason == "文件不存在"


def test_artifact_kind_classifies_common_outputs():
    assert art.artifact_kind("x.png") == "image"
    assert art.artifact_kind("x.mp4") == "video"
    assert art.artifact_kind("x.mp3") == "audio"
    assert art.artifact_kind("x.docx") == "file"


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
