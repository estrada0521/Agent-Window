from __future__ import annotations

import json
from pathlib import Path
from fs.log.paths import (
    agent_window_log_root,
    ensure_workspace_log_link,
    log_dir,
    log_jsonl_path,
    log_meta_path,
    workspace_log_link_path,
)
import os
import tempfile


class SessionMetaError(ValueError):
    pass


def read_session_meta_file(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def read_session_meta(session_name: str) -> dict:
    return read_session_meta_file(log_meta_path(session_name))


def _existing_session_meta(session_name: str) -> tuple[Path, dict]:
    name = str(session_name or "").strip()
    path = log_meta_path(name)
    try:
        return path, read_session_meta_file(path)
    except FileNotFoundError:
        raise SessionMetaError(f"log not found: {name}") from None


def session_workspace_claims(
    *,
    exclude_session: str = "",
) -> dict[str, tuple[str, str]]:
    exclude = str(exclude_session or "").strip()
    root = agent_window_log_root()
    claims: dict[str, tuple[str, str]] = {}
    if not root.is_dir():
        return claims
    for entry in root.iterdir():
        if not entry.is_dir() or entry.name == exclude:
            continue
        workspace = session_workspace(entry.name)
        claims[str(Path(workspace).expanduser().resolve())] = (entry.name, workspace)
    return claims


def find_session_for_workspace(workspace: Path | str, *, exclude_session: str = "") -> str | None:
    target = str(Path(workspace).expanduser().resolve())
    claim = session_workspace_claims(exclude_session=exclude_session).get(target)
    return claim[0] if claim else None


def session_workspace(session_name: str) -> str:
    return _existing_session_meta(session_name)[1]["workspace"]


def session_meta_agents(session_name: str) -> list[str]:
    return _existing_session_meta(session_name)[1]["agents"]


def set_session_workspace(session_name: str, workspace: str) -> None:
    name = str(session_name or "").strip()
    ws = str(workspace or "").strip()
    if not name or not ws:
        raise SessionMetaError("label and workspace are required")
    path, raw = _existing_session_meta(name)
    owner = find_session_for_workspace(ws, exclude_session=name)
    if owner:
        raise SessionMetaError(f"A timeline already exists for this workspace: {owner}")
    old_workspace = Path(raw["workspace"]).expanduser().resolve()
    raw["workspace"] = ws
    write_json_atomically(path, raw, indent=2)
    old_link = workspace_log_link_path(old_workspace)
    if old_workspace != Path(ws).expanduser().resolve() and old_link.is_symlink():
        old_link.unlink()
    ensure_workspace_log_link(name, ws)


def rename_session(old_name: str, new_name: str) -> None:
    log_dir(old_name).rename(log_dir(new_name))
    link = workspace_log_link_path(session_workspace(new_name))
    if link.is_symlink():
        link.unlink()
        link.symlink_to(log_jsonl_path(new_name))


def reset_session_agents(session_name: str) -> None:
    name = str(session_name or "").strip()
    if not name:
        raise SessionMetaError("label is required")
    path, raw = _existing_session_meta(name)
    raw["agents"] = []
    write_json_atomically(path, raw, indent=2)


def write_session_meta_file(
    session_name: str,
    workspace: str,
    agents: list[str],
) -> None:
    write_json_atomically(
        log_meta_path(session_name),
        {"workspace": workspace, "agents": agents},
        indent=2,
    )


def create_session_folder(session_name: str, workspace: str, agents: list[str]) -> None:
    log_dir(session_name).mkdir(parents=True)
    write_session_meta_file(session_name, workspace, agents)
    log_jsonl_path(session_name).touch()


def write_json_atomically(path: Path, data: dict, *, indent: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=indent)
            handle.write("\n")
        os.replace(tmp_path, path)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise
