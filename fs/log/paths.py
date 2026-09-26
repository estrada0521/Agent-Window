from __future__ import annotations

import hashlib
import re
import socket
from pathlib import Path


LOG_FILENAME = ".log.jsonl"
META_FILENAME = ".meta"
LABEL_MAX_LENGTH = 64


def sanitize_label(raw: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.\-]", "-", str(raw or "")).strip(".-")[:LABEL_MAX_LENGTH]


def agent_window_root() -> Path:
    return Path.home() / ".agent-window"


def agent_window_log_root() -> Path:
    return agent_window_root() / "log"


def log_dir(session_name: str) -> Path:
    return agent_window_log_root() / str(session_name or "").strip()


def log_jsonl_path(session_name: str) -> Path:
    return log_dir(session_name) / LOG_FILENAME


def log_meta_path(session_name: str) -> Path:
    return log_dir(session_name) / META_FILENAME


def workspace_agent_window_dir(workspace: Path | str) -> Path:
    return Path(workspace).expanduser() / ".agent-window"


def workspace_log_link_path(workspace: Path | str) -> Path:
    return workspace_agent_window_dir(workspace) / LOG_FILENAME


def ensure_workspace_log_link(session_name: str, workspace: Path | str) -> None:
    workspace_path = Path(workspace).expanduser()
    if not workspace_path.is_dir():
        raise FileNotFoundError(f"workspace is not a directory: {workspace_path}")
    aw_dir = workspace_agent_window_dir(workspace_path)
    aw_dir.mkdir(parents=True, exist_ok=True)
    gitignore = aw_dir / ".gitignore"
    if not gitignore.exists():
        gitignore.write_text("*\n", encoding="utf-8")
    mirrors = ((log_jsonl_path(session_name), workspace_log_link_path(workspace_path)),)
    for target, link_path in mirrors:
        link_path.parent.mkdir(parents=True, exist_ok=True)
        if link_path.is_symlink():
            if link_path.resolve() == target.resolve():
                continue
            link_path.unlink()
        elif link_path.exists():
            link_path.unlink()
        link_path.symlink_to(target)


def workspace_upload_dir(workspace: Path | str) -> Path:
    return workspace_agent_window_dir(workspace) / "uploads"


def workspace_room_port(workspace: Path | str) -> int:
    canonical_workspace = str(Path(workspace).expanduser().resolve())
    digest = int(hashlib.md5(canonical_workspace.encode()).hexdigest(), 16)
    return 30000 + (digest % 19000)


def port_is_bindable(port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("127.0.0.1", int(port)))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def normalize_workspace(value: str) -> str:
    return str(Path(value).expanduser().resolve())
