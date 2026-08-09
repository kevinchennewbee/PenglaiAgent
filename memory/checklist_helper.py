# checklist_helper.py — CL(folder) 一站式任务清单（支持 checklist/mapreduce 两种模式）
import json, time, subprocess, socket, sys, os, secrets
from pathlib import Path
_R = Path(__file__).resolve().parent.parent
_BBS, _MAIN = _R/"assets/agent_bbs.py", _R/"agentmain.py"
_W_RE, _M_RE = _R/"reflect/agent_team_worker.py", _R/"reflect/checklist_master.py"
_PK = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
if sys.platform == "win32": _PK["creationflags"] = 0x200

class CL:
    def __init__(self, folder, goal="", workers=0):
        """
        workers=0: checklist模式，master自己逐个执行，不启动BBS
        workers>0: mapreduce模式，启动BBS+N个worker并行
        """
        self.folder = Path(folder); self.folder.mkdir(parents=True, exist_ok=True)
        self.path = self.folder / "state.json"
        self.workers = workers
        if self.path.exists(): self._d = json.loads(self.path.read_text("utf-8"))
        else:
            self._d = {"closed": False, "goal": goal, "bbs": None, "tasks": []}
            self._save()
            if workers > 0:
                self._ensure_bbs()
                self.start_worker(workers)

    @property
    def tasks(self): return self._d["tasks"]
    @property
    def closed(self): return self._d.get("closed", False)
    @property
    def has_open(self): return any(t["result"] is None for t in self.tasks)
    @property
    def bbs_url(self): return self._d["bbs"]["url"] if self._d["bbs"] else None
    @property
    def bbs_key(self): return self._d["bbs"]["key"] if self._d["bbs"] else None
    @property
    def mode(self): return "mapreduce" if self._d["bbs"] else "checklist"
    def _save(self):
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(json.dumps(self._d, ensure_ascii=False, indent=1))
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(self.path, 0o600)

    def _ensure_bbs(self):
        if self._d["bbs"]: return
        with socket.socket() as s: s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
        key = secrets.token_urlsafe(32)
        (self.folder/"bbs").mkdir(exist_ok=True)
        child_env = os.environ.copy()
        child_env["PENGLAI_BBS_BOARD_KEY"] = key
        subprocess.Popen([sys.executable, str(_BBS), "--cwd", str(self.folder/"bbs"),
                          "--port", str(port)], env=child_env, **_PK)
        time.sleep(1)
        self._d["bbs"] = {"url": f"http://127.0.0.1:{port}", "key": key}
        self._save()

    def add(self, texts):
        nid = max((t["id"] for t in self.tasks), default=0) + 1
        ids = []
        for t in texts:
            self.tasks.append({"id": nid, "text": t, "result": None, "ts": int(time.time())})
            ids.append(nid); nid += 1
        self._save(); 
        print('task added, must reread checklist SOP before start executing ...');
        return ids

    def mark(self, tid, result):
        for t in self.tasks:
            if t["id"] == tid: t["result"] = result; t["ts"] = int(time.time()); break
        self._save()

    def look(self):
        done = sum(1 for t in self.tasks if t["result"] is not None)
        lines = [f"[{done}/{len(self.tasks)}] mode={self.mode}"]
        for t in self.tasks:
            l = f'{"✓" if t["result"] else "○"} #{t["id"]} {t["text"][:60]}'
            if t["result"]: l += f'  → {t["result"][:60]}'
            lines.append(l)
        return "\n".join(lines)

    def close(self):
        assert not self.has_open, "has open tasks"
        self._d["closed"] = True; self._save()

    def start_worker(self, n=None):
        n = n or self.workers or 1
        if n <= 0: return
        child_env = os.environ.copy()
        child_env["PENGLAI_BBS_BOARD_KEY"] = self.bbs_key
        for i in range(n):
            subprocess.Popen([sys.executable, str(_MAIN), "--reflect", str(_W_RE),
                "--base_url", self.bbs_url, "--name", f"w{i+1}"], env=child_env, **_PK)
            if i < n - 1: time.sleep(5)

    def _pid_alive(self, pid):
        if not pid: return False
        try:
            r = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True)
            return str(pid) in r.stdout
        except Exception: return False

    def start_master(self):
        old_pid = self._d.get("master_pid")
        if old_pid and self._pid_alive(old_pid):
            print(f"[CL] master already running (PID {old_pid}), skip")
            return
        p = subprocess.Popen([sys.executable, str(_MAIN), "--reflect", str(_M_RE),
            "--mr_folder", str(self.folder.resolve())], **_PK)
        self._d["master_pid"] = p.pid; self._save()
