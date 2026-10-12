from __future__ import annotations

import hashlib
import re
from pathlib import Path


LOG_FILENAME = ".log.jsonl"
META_FILENAME = ".meta"
TIMELINE_NAME_MAX_LENGTH = 64


def sanitize_timeline_name(raw: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.\-]", "-", str(raw or "")).strip(".-")[:TIMELINE_NAME_MAX_LENGTH]


def agent_window_root() -> Path:
    return Path.home() / ".agent-window"


def agent_window_log_root() -> Path:
    return agent_window_root() / "log"


def log_dir(timeline_name: str) -> Path:
    return agent_window_log_root() / str(timeline_name or "").strip()


def log_jsonl_path(timeline_name: str) -> Path:
    return log_dir(timeline_name) / LOG_FILENAME


def log_meta_path(timeline_name: str) -> Path:
    return log_dir(timeline_name) / META_FILENAME


def workspace_agent_window_dir(workspace: Path | str) -> Path:
    return Path(workspace).expanduser() / ".agent-window"


def workspace_log_link_path(workspace: Path | str) -> Path:
    return workspace_agent_window_dir(workspace) / LOG_FILENAME


def ensure_workspace_log_link(timeline_name: str, workspace: Path | str) -> None:
    workspace_path = Path(workspace).expanduser()
    if not workspace_path.is_dir():
        raise FileNotFoundError(f"workspace is not a directory: {workspace_path}")
    aw_dir = workspace_agent_window_dir(workspace_path)
    aw_dir.mkdir(parents=True, exist_ok=True)
    gitignore = aw_dir / ".gitignore"
    if not gitignore.exists():
        gitignore.write_text("*\n", encoding="utf-8")
    target = log_jsonl_path(timeline_name)
    link_path = workspace_log_link_path(workspace_path)
    if link_path.is_symlink() and link_path.resolve() == target.resolve():
        return
    if link_path.is_symlink() or link_path.exists():
        link_path.unlink()
    link_path.symlink_to(target)


def workspace_upload_dir(workspace: Path | str) -> Path:
    return workspace_agent_window_dir(workspace) / "uploads"


def workspace_timeline_path(workspace: Path | str) -> str:
    canonical_workspace = normalize_workspace(workspace)
    return "/timeline/" + hashlib.md5(canonical_workspace.encode()).hexdigest()


def normalize_workspace(value: str) -> str:
    return str(Path(value).expanduser().resolve())
