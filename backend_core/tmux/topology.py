from __future__ import annotations

import hashlib
import os
import shutil
import time
from pathlib import Path


def default_tmux_socket_name() -> str:
    return "agent-window"


def session_topology_lock_path(tmux_socket: str, session_name: str) -> Path:
    safe = (session_name or "default").replace("/", "_")
    sock = tmux_socket or "default"
    digest = hashlib.sha1(f"{sock}|{safe}".encode()).hexdigest()[:20]
    run_dir = Path(os.environ.get("AGENT_WINDOW_RUN_DIR") or (Path.home() / ".agent-window" / "run"))
    return run_dir / "topology-locks" / f"{digest}.lock"


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except Exception:
        return False
    return True


def _read_lock_pid(lock_dir: Path) -> int:
    pid_file = lock_dir / "pid"
    if not pid_file.is_file():
        return 0
    try:
        return int(pid_file.read_text(encoding="utf-8").strip())
    except Exception:
        return 0


def acquire_topology_lock(
    lock_dir: Path | str,
    holder_pid: int,
    *,
    max_attempts: int = 400,
    sleep_seconds: float = 0.05,
) -> bool:
    lock_path = Path(lock_dir)
    attempts = 0
    while True:
        try:
            lock_path.parent.mkdir(parents=True, exist_ok=True)
            lock_path.mkdir()
            (lock_path / "pid").write_text(str(holder_pid), encoding="utf-8")
            return True
        except FileExistsError:
            existing_pid = _read_lock_pid(lock_path)
            if existing_pid and not _pid_alive(existing_pid):
                shutil.rmtree(lock_path, ignore_errors=True)
                continue
            attempts += 1
            if attempts >= max_attempts:
                return False
            time.sleep(max(0.0, sleep_seconds))


def release_topology_lock(lock_dir: Path | str) -> None:
    shutil.rmtree(Path(lock_dir), ignore_errors=True)
