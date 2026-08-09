import importlib.util
import os
from pathlib import Path

from fastapi.testclient import TestClient


def load_bbs(tmp_path: Path):
    source = Path(__file__).resolve().parents[1] / "assets" / "agent_bbs.py"
    spec = importlib.util.spec_from_file_location("penglai_test_agent_bbs", source)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    key = "board-key-" + "x" * 32
    module.BOARDS_FILE = None
    module.BOARDS.clear()
    module.BOARDS[key] = {"name": "test", "db": str(tmp_path / "bbs.sqlite3")}
    module.BOARDS_MTIME_NS = None
    module.UPLOAD_DIR = str(tmp_path / "uploads")
    return module, key


def test_bbs_keeps_board_key_out_of_query_strings(tmp_path):
    module, key = load_bbs(tmp_path)
    with TestClient(module.app) as client:
        assert client.get("/").status_code == 200
        assert "password" in client.get("/").text
        assert client.get(f"/readme?key={key}").status_code == 404

        login = client.post("/auth", data={"key": key}, follow_redirects=False)
        assert login.status_code == 303
        cookie = login.cookies.get("penglai_bbs_key")
        assert cookie == key
        assert "HttpOnly" in login.headers["set-cookie"]
        assert "SameSite=strict" in login.headers["set-cookie"]

        readme = client.get("/readme", headers={"X-API-Key": key})
        assert readme.status_code == 200
        assert "never put credentials in query strings" in readme.text


def test_bbs_registration_does_not_disclose_existing_token(tmp_path):
    module, key = load_bbs(tmp_path)
    headers = {"X-API-Key": key}
    with TestClient(module.app) as client:
        first = client.post("/register", headers=headers, json={"name": "worker"})
        assert first.status_code == 200
        assert len(first.json()["token"]) == 64
        duplicate = client.post("/register", headers=headers, json={"name": "worker"})
        assert duplicate.status_code == 409
        assert "token" not in duplicate.text.lower()
        upload = client.post(
            "/file/upload",
            headers=headers,
            data={"token": first.json()["token"]},
            files={"file": ("brief.txt", b"owner brief", "text/plain")},
        )
        assert upload.status_code == 200
        if os.name != "nt":
            assert (tmp_path / "bbs.sqlite3").stat().st_mode & 0o777 == 0o600
            assert (tmp_path / "uploads").stat().st_mode & 0o777 == 0o700
            reference = upload.json()["ref"].split("/")
            assert (tmp_path / "uploads" / reference[0] / reference[1]).stat().st_mode & 0o777 == 0o600


def test_bbs_download_rejects_path_escape(tmp_path):
    module, key = load_bbs(tmp_path)
    with TestClient(module.app) as client:
        response = client.get("/file/not-hex/passwd", headers={"X-API-Key": key})
        assert response.status_code == 404


def test_bbs_launchers_never_put_board_keys_in_argv_or_model_prompts():
    root = Path(__file__).resolve().parents[1]
    helper = (root / "memory" / "checklist_helper.py").read_text("utf-8")
    worker = (root / "reflect" / "agent_team_worker.py").read_text("utf-8")
    server = (root / "assets" / "agent_bbs.py").read_text("utf-8")
    assert '"--board_key"' not in helper
    assert '"--key"' not in helper
    assert "(key: {board_key})" not in worker
    assert "PENGLAI_BBS_BOARD_KEY" in helper
    assert "PENGLAI_BBS_BOARD_KEY" in worker
    assert "PENGLAI_BBS_BOARD_KEY" in server


def test_legacy_bbs_workers_refuse_non_loopback_targets():
    root = Path(__file__).resolve().parents[1]
    for relative in ("reflect/agent_team_worker.py", "reflect/checklist_master.py"):
        source = root / relative
        spec = importlib.util.spec_from_file_location(f"bbs_worker_{source.stem}", source)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        assert module._http_base_url("http://127.0.0.1:58800") == "http://127.0.0.1:58800"
        try:
            module._http_base_url("https://169.254.169.254/latest/meta-data")
        except ValueError as error:
            assert "loopback" in str(error)
        else:
            raise AssertionError("non-loopback BBS target was accepted")
