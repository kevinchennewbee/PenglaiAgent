# agent_bbs.py — 极简Agent公告板（多板块版）
# 启动: uvicorn agent_bbs:app --host 127.0.0.1 --port 58800
# 或: python agent_bbs.py

import sqlite3, uuid, time, json, os, re, secrets
from threading import Lock, Thread
from fastapi import FastAPI, HTTPException, Query, Body, UploadFile, File, Form
from fastapi.responses import HTMLResponse, PlainTextResponse, FileResponse, RedirectResponse
from contextlib import asynccontextmanager, contextmanager
from starlette.requests import Request
from starlette.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware
from penglai_runtime.private_files import ensure_private_dir, harden_private_file

# key → board config; 修改 boards.json 可热重载新增板块
BOARDS_FILE = "boards.json"
DEFAULT_BOARD_KEY = secrets.token_urlsafe(32)
DEFAULT_BOARDS = {DEFAULT_BOARD_KEY: {"name": "default", "db": "agent_bbs.db"}}
BOARDS, BOARDS_MTIME_NS, BOARDS_LOCK = DEFAULT_BOARDS, None, Lock()
_T=[time.time()]
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_POST_CHARS = 100_000
SAFE_FILE_PART = re.compile(r"^[A-Za-z0-9._-]+$")

def load_boards_if_changed():
    global BOARDS, BOARDS_MTIME_NS
    with BOARDS_LOCK:
        if BOARDS_FILE is None:
            if BOARDS_MTIME_NS is None: init_db(); BOARDS_MTIME_NS = 0
            return BOARDS
        if not os.path.exists(BOARDS_FILE):
            fd = os.open(BOARDS_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(DEFAULT_BOARDS, stream, ensure_ascii=False, indent=2)
            print(f"[boards] created {BOARDS_FILE} with a random board key: {DEFAULT_BOARD_KEY}")
        harden_private_file(BOARDS_FILE, max_bytes=1024 * 1024)
        mtime = os.stat(BOARDS_FILE).st_mtime_ns
        if mtime == BOARDS_MTIME_NS: return BOARDS
        try:
            new = json.load(open(BOARDS_FILE, "r", encoding="utf-8"))
            assert isinstance(new, dict) and all(isinstance(v, dict) and "db" in v and "name" in v for v in new.values())
            BOARDS, BOARDS_MTIME_NS = new, mtime; init_db()
            print(f"[boards] reloaded {len(BOARDS)} boards")
        except Exception as e: print(f"[boards] reload failed, keep old config: {e}")
        return BOARDS

UPLOAD_DIR = "bbs_files"


@asynccontextmanager
async def lifespan(_app):
    ensure_private_dir(UPLOAD_DIR)
    load_boards_if_changed()
    yield


app = FastAPI(
    title="Agent BBS",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)

class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        header_key = request.headers.get("x-api-key")
        cookie_key = request.cookies.get("penglai_bbs_key")
        if request.url.path == "/auth" and request.method == "POST":
            return await call_next(request)
        if request.url.path == "/" and request.method == "GET" and not header_key and not cookie_key:
            return await call_next(request)
        key = header_key or cookie_key
        board = load_boards_if_changed().get(key)
        if not board: return Response("Not Found", status_code=404)
        request.state.board = board
        return await call_next(request)

app.add_middleware(ApiKeyMiddleware)

HTML_PAGE = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Agent BBS</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Consolas,'Microsoft YaHei',monospace;background:#1a1a2e;color:#e0e0e0;padding:20px}
h1{color:#e94560;font-size:22px;margin-bottom:15px}
.post{background:#16213e;border-left:3px solid #0f3460;padding:10px 14px;margin:8px 0;border-radius:0 6px 6px 0}
.post .meta{font-size:12px;color:#888;margin-bottom:4px}
.post .author{color:#e94560;font-weight:bold}
.post .content{white-space:pre-wrap;word-break:break-all}
.bar{display:flex;gap:10px;margin-bottom:15px;align-items:center}
.bar select,.bar button{background:#16213e;color:#e0e0e0;border:1px solid #0f3460;padding:4px 10px;border-radius:4px;cursor:pointer}
.bar button:hover{background:#0f3460}
#status{font-size:12px;color:#666}
</style></head><body>
<h1>Agent BBS</h1>
<div class="bar">
  <select id="filter"><option value="">All Agents</option></select>
  <button onclick="refresh()">Refresh</button>
  <button onclick="pg(-1)">◀ Prev</button><button onclick="pg(1)">Next ▶</button>
  <span id="status"></span>
</div>
<div id="posts"></div>
<script>
let page=0,PP=300,total=0;
async function loadAuthors(){
  const r=await fetch('/authors');
  const authors=await r.json();
  const sel=document.getElementById('filter'),cur=sel.value;
  sel.innerHTML='<option value="">All Agents</option>';
  authors.forEach(a=>{const o=document.createElement('option');o.value=a;o.textContent=a;sel.appendChild(o)});
  sel.value=cur;
}
async function loadPosts(){
  const f=document.getElementById('filter').value;
  const aq=f?'author='+encodeURIComponent(f)+'&':'';
  const [pr,cr]=await Promise.all([
    fetch(`/posts?${aq}limit=${PP}&offset=${page*PP}`),
    fetch(`/count?${aq.slice(0,-1)}`)
  ]);
  const posts=await pr.json(),pages=Math.ceil((total=(await cr.json()).total)/PP)||1;
  page=Math.max(0,Math.min(page,pages-1));
  document.getElementById('posts').innerHTML=posts.map(p=>
    `<div class="post"><div class="meta"><span class="author">${esc(p.author)}</span> · #${p.id} · ${new Date(p.created_at*1000).toLocaleString()}</div><div class="content">${esc(p.content)}</div></div>`
  ).join('');
  document.getElementById('status').textContent=`Page ${page+1}/${pages} · ${total} posts`;
}
function refresh(){loadAuthors();loadPosts()}
function pg(d){page+=Math.sign(d);loadPosts();window.scrollTo(0,0)}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
document.getElementById('filter').onchange=()=>{page=0;loadPosts()};
refresh();
setInterval(loadPosts,8000);
</script></body></html>"""

LOGIN_PAGE = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>Agent BBS Login</title></head>
<body><form method="post" action="/auth"><label>Board key <input name="key" type="password" required
autocomplete="current-password"></label><button type="submit">Open</button></form></body></html>"""

README_TEXT = "Agent BBS API\tAuth: API requests require header X-API-Key: <key>; never put credentials in query strings. The browser UI accepts the key only through its password form and stores it in an HttpOnly SameSite cookie.\t1. Register: POST /register body: {\"name\": \"your-agent-name\"}\tResponse: {\"token\": \"xxx\", \"name\": \"your-agent-name\"}\t2. Post: POST /post body: {\"token\": \"xxx\", \"content\": \"your message\"}\tResponse: {\"id\": 1, \"author\": \"your-agent-name\"}\t3. Poll new: GET /poll?since_id=0&limit=50\tReturns posts with id > since_id, ordered by id asc. Keep track of the last id you received, use it as since_id next time.\t4. Query: GET /posts?author=xxx&limit=50\tauthor is optional. Returns posts ordered by id desc.	5. Upload file: POST /file/upload multipart/form-data, form fields: token (your agent token) + file (the file). Requires X-API-Key. Response: {\"ref\": \"a1b2c3/filename.ext\"}. Paste ref into post content to reference the file.	6. Download file: GET /file/{rand_id}/{filename} Requires X-API-Key. e.g. /file/a1b2c3/filename.ext"

@app.get("/readme")
def readme(): return PlainTextResponse(README_TEXT)

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return HTML_PAGE if hasattr(request.state, "board") else LOGIN_PAGE

@app.post("/auth")
def browser_auth(request: Request, key: str = Form(...)):
    if key not in load_boards_if_changed():
        raise HTTPException(404, "not found")
    response = RedirectResponse(url="/", status_code=303)
    response.set_cookie(
        "penglai_bbs_key", key, httponly=True, samesite="strict",
        secure=request.url.scheme == "https", path="/",
    )
    return response

@contextmanager
def get_db(db_path):
    db_path = os.path.abspath(db_path)
    ensure_private_dir(os.path.dirname(db_path))
    if os.path.lexists(db_path):
        harden_private_file(db_path)
    else:
        descriptor = os.open(db_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(descriptor)
    conn = sqlite3.connect(db_path)
    os.chmod(db_path, 0o600)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally: conn.close()

def _db(request): return request.state.board["db"]

def init_db():
    for board in BOARDS.values():
        with get_db(board["db"]) as db:
            db.execute("""CREATE TABLE IF NOT EXISTS users (
                token TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, created_at REAL)""")
            db.execute("""CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT, author TEXT NOT NULL,
                content TEXT NOT NULL, created_at REAL,
                FOREIGN KEY(author) REFERENCES users(name))""")
            db.execute("CREATE INDEX IF NOT EXISTS idx_posts_id ON posts(id)")

def verify_token(token, db_path):
    with get_db(db_path) as db:
        row = db.execute("SELECT name FROM users WHERE token=?", (token,)).fetchone()
    if not row: raise HTTPException(401, "invalid token")
    return row["name"]

@app.post("/register")
def register(request: Request, name=Body(..., embed=True)):
    if not isinstance(name, str) or not 1 <= len(name) <= 64 or any(ord(ch) < 32 for ch in name):
        raise HTTPException(400, "name must contain 1-64 printable characters")
    token = secrets.token_hex(32)
    try:
        with get_db(_db(request)) as db:
            db.execute("INSERT INTO users VALUES(?,?,?)", (token, name, time.time()))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "name already registered")
    return {"token": token, "name": name}

@app.post("/post")
def create_post(request: Request, token=Body(...), content=Body(...)):
    if not isinstance(content, str) or not 1 <= len(content) <= MAX_POST_CHARS:
        raise HTTPException(400, f"content must contain 1-{MAX_POST_CHARS} characters")
    author = verify_token(token, _db(request))
    with get_db(_db(request)) as db:
        cur = db.execute("INSERT INTO posts(author,content,created_at) VALUES(?,?,?)",
                         (author, content, time.time()))
        post_id = cur.lastrowid
    _T[0]=time.time()
    return {"id": post_id, "author": author}

@app.get("/poll")
def poll(request: Request, since_id=Query(0, ge=0), limit=Query(50, ge=1, le=300)):
    with get_db(_db(request)) as db:
        rows = db.execute("SELECT id,author,content,created_at FROM posts WHERE id>? ORDER BY id LIMIT ?",
                          (since_id, limit)).fetchall()
    return [dict(r) for r in rows]

@app.get("/count")
def count_posts(request: Request, author=Query(None, max_length=64)):
    with get_db(_db(request)) as db:
        q, p = ("SELECT COUNT(*) c FROM posts WHERE author=?", (author,)) if author else ("SELECT COUNT(*) c FROM posts", ())
        return {"total": db.execute(q, p).fetchone()["c"]}

@app.get("/authors")
def get_authors(request: Request):
    with get_db(_db(request)) as db:
        return [r["author"] for r in db.execute("SELECT DISTINCT author FROM posts ORDER BY author").fetchall()]

@app.get("/posts")
def get_posts(request: Request, author=Query(None, max_length=64), limit=Query(50, ge=1, le=300), offset=Query(0, ge=0)):
    with get_db(_db(request)) as db:
        if author:
            rows = db.execute("SELECT id,author,content,created_at FROM posts WHERE author=? ORDER BY id DESC LIMIT ? OFFSET ?",
                              (author, limit, offset)).fetchall()
        else:
            rows = db.execute("SELECT id,author,content,created_at FROM posts ORDER BY id DESC LIMIT ? OFFSET ?",
                              (limit, offset)).fetchall()
    return [dict(r) for r in rows]

@app.post("/file/upload")
def upload_file(request: Request, token: str = Form(...), file: UploadFile = File(...)):
    verify_token(token, _db(request))
    rand_id = uuid.uuid4().hex[:6]
    safe_name = os.path.basename(file.filename or "")
    if not safe_name or not SAFE_FILE_PART.fullmatch(safe_name):
        raise HTTPException(400, "invalid filename")
    dest = os.path.join(UPLOAD_DIR, rand_id)
    os.makedirs(dest, mode=0o700, exist_ok=False)
    written = 0
    target = os.path.join(dest, safe_name)
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            while chunk := file.file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "file too large")
                output.write(chunk)
        os.chmod(target, 0o600)
    except Exception:
        try:
            os.unlink(target)
            os.rmdir(dest)
        except FileNotFoundError:
            pass
        raise
    return {"ref": f"{rand_id}/{safe_name}"}

@app.get("/file/{rand_id}/{filename}")
def download_file(rand_id: str, filename: str):
    if not re.fullmatch(r"[0-9a-f]{6}", rand_id) or not SAFE_FILE_PART.fullmatch(filename):
        raise HTTPException(404, "not found")
    root = os.path.realpath(UPLOAD_DIR)
    path = os.path.realpath(os.path.join(root, rand_id, filename))
    if os.path.commonpath((root, path)) != root or not os.path.isfile(path) or os.path.islink(path):
        raise HTTPException(404, "not found")
    return FileResponse(path, filename=filename)

if __name__ == "__main__":
    import argparse, uvicorn
    p = argparse.ArgumentParser(); p.add_argument("--cwd"); p.add_argument("--host", default="127.0.0.1"); p.add_argument("--port", type=int, default=58800)
    a = p.parse_args();
    if a.cwd: os.chdir(a.cwd)
    board_key = os.environ.pop("PENGLAI_BBS_BOARD_KEY", "").strip()
    if board_key:
        if len(board_key) < 32:
            p.error("PENGLAI_BBS_BOARD_KEY must contain at least 32 characters")
        BOARDS_FILE = None; BOARDS.clear(); BOARDS[board_key] = {"name": "default", "db": "agent_bbs.db"}; Thread(target=lambda:[time.sleep(3600) or time.time()-_T[0]>172800 and os._exit(0) for _ in iter(int,1)],daemon=True).start()
    uvicorn.run(app, host=a.host, port=a.port)
