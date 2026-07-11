# -*- coding: utf-8 -*-
"""Worldline RewindStore + restore_plan 单元测试。

验证 0.3.6 同步的 worldline 检查点回溯后端：
- RewindStore 基本操作：track_pre_edit -> commit -> apply_code -> rewind_head
- reconcile 日志对账
- restore_plan 三种模式（both/conv/code）
- parse_native_log 反向移植验证
"""
import os
import sys
import json
import tempfile
import shutil
from types import SimpleNamespace

_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_DIR)
_FRONTENDS = os.path.join(_ROOT, "frontends")
for _p in (_ROOT, _FRONTENDS):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from worldline import (
    RewindStore,
    restore_plan,
    tree_from_store,
    CompressedTree,
    rewrite_projection,
)
import continue_cmd
from continue_cmd import (
    parse_native_log,
    _derive_hist_info,
    _is_empty_log,
    _load_history_into,
)


def _make_store(tmpdir, cwd=None):
    cwd = cwd or tmpdir
    root = os.path.join(tmpdir, ".ga_rewind", "test_session")
    return RewindStore(root, cwd)


def test_store_origin():
    """store 创建后应有 origin 节点。"""
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(tmp)
        # 空 store 还没有 origin（lazy），第一次 commit 后才有
        assert store.nodes == {} or "origin" in store.nodes or store.root_id is None
        nid = store.commit("first turn", history=[])
        assert nid in store.nodes
        store._ensure_origin()
        assert "origin" in store.nodes or store.root_id is not None
        print("  ✅ test_store_origin")


def test_track_and_commit():
    """track_pre_edit -> commit -> 节点有正确的 files。"""
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(tmp)
        test_file = os.path.join(tmp, "test.py")
        with open(test_file, "w") as f:
            f.write("original")
        store.track_pre_edit(test_file)
        with open(test_file, "w") as f:
            f.write("modified")
        nid = store.commit("edit test.py", history=[])
        assert nid in store.nodes
        nd = store.nodes[nid]
        assert "test.py" in nd["files"]
        assert nd["files"]["test.py"] is not None  # 有 hash
        print("  ✅ test_track_and_commit")


def test_apply_code_restores_file():
    """apply_code 把工作区文件还原到节点状态。"""
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(tmp)
        test_file = os.path.join(tmp, "test.py")
        with open(test_file, "w") as f:
            f.write("original")
        store.track_pre_edit(test_file)
        with open(test_file, "w") as f:
            f.write("modified")
        nid = store.commit("edit", history=[])
        # 再改一次
        with open(test_file, "w") as f:
            f.write("modified again")
        # 回退到 nid
        changed = store.apply_code(nid)
        assert any(rel == "test.py" for rel, _ in changed)
        with open(test_file, "r") as f:
            assert f.read() == "modified"
        print("  ✅ test_apply_code_restores_file")


def test_rewind_head():
    """rewind_head 移动 HEAD 不动文件。"""
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(tmp)
        nid1 = store.commit("turn 1", history=[])
        nid2 = store.commit("turn 2", history=[])
        assert store.head == nid2
        store.rewind_head(nid1)
        assert store.head == nid1
        print("  ✅ test_rewind_head")


def test_rebuild_history():
    """rebuild_history 沿路径拼接对话增量。"""
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(tmp)
        hist1 = [{"role": "user", "content": "hello"},
                 {"role": "assistant", "content": [{"type": "text", "text": "hi"}]}]
        hist2 = [{"role": "user", "content": "bye"},
                 {"role": "assistant", "content": [{"type": "text", "text": "bye"}]}]
        nid1 = store.commit("turn 1", history=hist1)
        nid2 = store.commit("turn 2", history=hist1 + hist2)
        rebuilt = store.rebuild_history(nid2)
        assert len(rebuilt) == 4
        assert rebuilt[0]["role"] == "user"
        assert rebuilt[2]["role"] == "user"
        print("  ✅ test_rebuild_history")


def test_linear_path():
    """linear_path 返回 root -> HEAD 的路径。"""
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(tmp)
        nid1 = store.commit("turn 1", history=[])
        nid2 = store.commit("turn 2", history=[])
        path = store.linear_path()
        assert nid1 in path and nid2 in path
        assert path.index(nid1) < path.index(nid2)
        print("  ✅ test_linear_path")


def test_compressed_tree():
    """CompressedTree 折叠线性段。"""
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(tmp)
        for i in range(5):
            store.commit(f"turn {i}", history=[])
        tree = tree_from_store(store, __import__("time").time())
        ct = CompressedTree(tree)
        flat = ct.flatten()
        assert len(flat) > 0
        print("  ✅ test_compressed_tree")


def test_parse_native_log_empty():
    """parse_native_log 对空文件返回 None 或 []。"""
    with tempfile.TemporaryDirectory() as tmp:
        empty_path = os.path.join(tmp, "empty.txt")
        with open(empty_path, "w") as f:
            f.write("")
        # allow_empty=True 应返回 []
        result = parse_native_log(empty_path, allow_empty=True)
        assert result == []
        # allow_empty=False 应返回 None
        result = parse_native_log(empty_path, allow_empty=False)
        assert result is None
        print("  ✅ test_parse_native_log_empty")


def test_parse_native_log_with_content():
    """parse_native_log 解析 native 格式日志。"""
    with tempfile.TemporaryDirectory() as tmp:
        log_path = os.path.join(tmp, "model_responses_test.txt")
        prompt = json.dumps({"role": "user", "content": [{"type": "text", "text": "hello"}]})
        response = repr([{"type": "text", "text": "hi there"}])
        with open(log_path, "w") as f:
            f.write(f"=== Prompt === 2026-07-11 12:00:00\n{prompt}\n\n")
            f.write(f"=== Response === 2026-07-11 12:00:01\n{response}\n\n")
        result = parse_native_log(log_path)
        assert result is not None
        assert len(result) == 2
        assert result[0]["role"] == "user"
        assert result[1]["role"] == "assistant"
        print("  ✅ test_parse_native_log_with_content")


def test_derive_hist_info():
    """_derive_hist_info 从 history 重建轮级纪要。"""
    history = [
        {"role": "user", "content": "what is 1+1"},
        {"role": "assistant", "content": [{"type": "text", "text": "<summary>数学计算</summary>答案是2"}]},
    ]
    info = _derive_hist_info(history)
    assert len(info) == 2
    assert "[USER]:" in info[0]
    assert "[Agent]" in info[1]
    assert "数学计算" in info[1]
    print("  ✅ test_derive_hist_info")


def test_load_history_restores_working_memory():
    """Worldline opt-in continue restores backend history and working memory together."""
    with tempfile.TemporaryDirectory() as tmp:
        log_path = os.path.join(tmp, "model_responses_123456.txt")
        prompt = json.dumps({
            "role": "user",
            "content": [{"type": "text", "text": "remember this"}],
        })
        response = repr([{
            "type": "text",
            "text": "<summary>saved checkpoint</summary>done",
        }])
        with open(log_path, "w", encoding="utf-8") as fh:
            fh.write(f"=== Prompt === 2026-07-11 12:00:00\n{prompt}\n\n")
            fh.write(f"=== Response === 2026-07-11 12:00:01\n{response}\n\n")

        backend = SimpleNamespace(history=[])
        agent = SimpleNamespace(
            llmclient=SimpleNamespace(backend=backend),
            history=["stale working memory"],
        )
        message, ok = _load_history_into(agent, log_path, restore_wm=True)

        assert ok is True
        assert message.startswith("✅ 已恢复 1 轮完整对话")
        assert len(backend.history) == 2
        assert agent.history == [
            "[USER]: remember this",
            "[Agent] saved checkpoint",
        ]


def test_list_sessions_discovers_only_existing_empty_worldline_logs(monkeypatch, tmp_path):
    """Origin-rewound sessions remain resumable; archived/missing logs stay hidden."""
    log_dir = tmp_path / "logs"
    rewind_root = tmp_path / ".ga_rewind"
    log_dir.mkdir()
    rewind_root.mkdir()

    key = "model_responses_123456"
    log_path = log_dir / f"{key}.txt"
    log_path.write_text("", encoding="utf-8")
    tree_dir = rewind_root / key
    tree_dir.mkdir()
    (tree_dir / "tree.json").write_text(json.dumps({
        "head": "origin",
        "nodes": {
            "origin": {"kind": "origin", "title": ""},
            "turn-1": {"kind": "turn", "title": "first question"},
        },
    }), encoding="utf-8")

    monkeypatch.setattr(continue_cmd, "_LOG_DIR", str(log_dir))
    monkeypatch.setattr(continue_cmd, "_LOG_GLOB", str(log_dir / "model_responses_*.txt"))
    monkeypatch.setattr(continue_cmd, "_save_rounds_cache", lambda _keys: None)

    sessions = continue_cmd.list_sessions(rewind_root=str(rewind_root))
    assert [row[0] for row in sessions] == [str(log_path)]
    assert sessions[0][2] == "[世界线] （已回退至会话起点）"

    log_path.unlink()
    assert continue_cmd.list_sessions(rewind_root=str(rewind_root)) == []


def test_is_empty_log():
    """_is_empty_log 判断日志是否为空。"""
    with tempfile.TemporaryDirectory() as tmp:
        empty_path = os.path.join(tmp, "empty.txt")
        with open(empty_path, "w") as f:
            f.write("")
        assert _is_empty_log(empty_path) is True

        nonempty_path = os.path.join(tmp, "nonempty.txt")
        with open(nonempty_path, "w") as f:
            f.write("x" * 100)
        assert _is_empty_log(nonempty_path) is False

        assert _is_empty_log(os.path.join(tmp, "nonexistent.txt")) is True
        print("  ✅ test_is_empty_log")


def test_restore_plan_both():
    """restore_plan mode=both 回退对话和代码。"""
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(tmp)
        test_file = os.path.join(tmp, "test.py")
        with open(test_file, "w") as f:
            f.write("original")
        store.track_pre_edit(test_file)
        with open(test_file, "w") as f:
            f.write("modified")
        hist = [{"role": "user", "content": "edit file"},
                {"role": "assistant", "content": [{"type": "text", "text": "done"}]}]
        nid = store.commit("edit", history=hist)
        with open(test_file, "w") as f:
            f.write("modified again")
        result = restore_plan(store, nid, mode="both", to="before")
        assert result is not None
        assert result["history"] is not None
        assert len(result["changed"]) > 0  # 文件有变化
        print("  ✅ test_restore_plan_both")


def test_diff():
    """diff 返回节点 vs 当前工作区的变更摘要。"""
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(tmp)
        test_file = os.path.join(tmp, "test.py")
        with open(test_file, "w") as f:
            f.write("original")
        store.track_pre_edit(test_file)
        with open(test_file, "w") as f:
            f.write("modified")
        nid = store.commit("edit", history=[])
        with open(test_file, "w") as f:
            f.write("different")
        diffs = store.diff(nid)
        assert len(diffs) > 0
        assert diffs[0]["rel"] == "test.py"
        print("  ✅ test_diff")


def test_delete_subtree():
    """delete_subtree 删除节点及子树。"""
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(tmp)
        nid1 = store.commit("turn 1", history=[])
        nid2 = store.commit("turn 2", history=[])
        victims = store.delete_subtree(nid2)
        assert nid2 in victims
        assert nid2 not in store.nodes
        print("  ✅ test_delete_subtree")


def test_resume_from():
    """resume_from 把旧会话的 rewind 目录接到本 store。"""
    with tempfile.TemporaryDirectory() as tmp:
        old_dir = os.path.join(tmp, "old_session")
        old_store = RewindStore(old_dir, tmp)
        old_store.commit("old turn", history=[])

        new_dir = os.path.join(tmp, "new_session")
        new_store = RewindStore(new_dir, tmp)
        assert new_store.resume_from(old_dir) is True
        assert len(new_store.nodes) > 0
        print("  ✅ test_resume_from")


def run_tests():
    tests = [
        test_store_origin,
        test_track_and_commit,
        test_apply_code_restores_file,
        test_rewind_head,
        test_rebuild_history,
        test_linear_path,
        test_compressed_tree,
        test_parse_native_log_empty,
        test_parse_native_log_with_content,
        test_derive_hist_info,
        test_is_empty_log,
        test_restore_plan_both,
        test_diff,
        test_delete_subtree,
        test_resume_from,
    ]
    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            passed += 1
        except Exception as e:
            print(f"  ❌ {t.__name__}: {e}")
            import traceback
            traceback.print_exc()
            failed += 1
    print(f"\n{'='*40}")
    print(f"Worldline tests: {passed} passed, {failed} failed, {len(tests)} total")
    return failed == 0


if __name__ == "__main__":
    import sys
    sys.exit(0 if run_tests() else 1)
