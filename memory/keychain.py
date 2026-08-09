"""Private local secret file helper (not an operating-system keychain).

Use ``keys.set("name", file="path")`` and ``keys.name.use()``. The file is
owner-only (0600) and written atomically, but it is intentionally not described
as encryption: another process running as the same OS user can read it.
"""
import json, os, hashlib, pathlib, getpass
from penglai_runtime.private_files import atomic_write_private, harden_private_file

_PATH = pathlib.Path.home() / ".ga_keychain.json"
_LEGACY_PATH = pathlib.Path.home() / "ga_keychain.enc"
_MAX_BYTES = 1024 * 1024
try: _user = os.getlogin()
except OSError: _user = getpass.getuser()
_MASK = hashlib.sha256(f"{_user}@ga_keychain".encode()).digest()

def _xor(data: bytes) -> bytes:
    return bytes(b ^ _MASK[i % len(_MASK)] for i, b in enumerate(data))

print('# Local owner-only secret file (not OS keychain); SecretStr.use() returns raw data. | keys.ls() lists names')

class SecretStr:
    def __init__(self, name: str, val: str):
        self._name, self._val = name, val
    def use(self) -> str: return self._val
    def __repr__(self):
        return f"SecretStr({self._name}=***)"
    __str__ = __repr__

class _Keys:
    def __init__(self):
        self._d = {}
        if _PATH.exists():
            harden_private_file(_PATH, max_bytes=_MAX_BYTES)
            raw = json.loads(_PATH.read_text("utf-8"))
            if not isinstance(raw, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in raw.items()):
                raise RuntimeError("local secret file has an invalid schema")
            self._d = {k: SecretStr(k, v) for k, v in raw.items()}
        elif _LEGACY_PATH.exists():
            harden_private_file(_LEGACY_PATH, max_bytes=_MAX_BYTES)
            raw = json.loads(_xor(_LEGACY_PATH.read_bytes()))
            if not isinstance(raw, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in raw.items()):
                raise RuntimeError("legacy secret file has an invalid schema")
            self._d = {k: SecretStr(k, v) for k, v in raw.items()}
            self._save()
            print(f"[keychain] Migrated legacy data to owner-only {_PATH}; legacy file was retained.")
    def _save(self):
        raw = {k: v.use() for k, v in self._d.items()}
        atomic_write_private(_PATH, json.dumps(raw), max_bytes=_MAX_BYTES)
    def __getattr__(self, k):
        if k.startswith('_'): raise AttributeError(k)
        if k not in self._d: raise KeyError(f"No secret: {k}")
        return self._d[k]
    def __repr__(self):
        return f"Keychain({len(self._d)} secrets: {', '.join(self._d.keys())})"
    def set(self, k, v=None, *, file=None):
        if file: v = pathlib.Path(file).read_text().strip()
        self._d[k] = SecretStr(k, v)
        self._save()
    def ls(self): return list(self._d.keys())

keys = _Keys()

def __getattr__(name): return getattr(keys, name)
