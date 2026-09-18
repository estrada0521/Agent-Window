from __future__ import annotations

import json
from pathlib import Path

from backend_core.access.atomic_json import write_json_atomically
from backend_core.access.settings import (
    agent_window_session_root,
    session_artifact_dir,
    session_log_path,
    session_meta_path,
)


class SessionMetaError(ValueError):
    pass


def read_session_meta_file(path: Path) -> dict | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def read_session_meta(session_name: str) -> dict | None:
    return read_session_meta_file(session_meta_path(session_name))


def _existing_session_meta(session_name: str) -> tuple[Path, dict]:
    name = str(session_name or "").strip()
    meta = read_session_meta(name)
    if meta is None:
        raise SessionMetaError(f"session not found: {name}")
    return session_meta_path(name), meta


def session_workspace_claims(
    *,
    exclude_session: str = "",
) -> dict[str, tuple[str, str]]:
    exclude = str(exclude_session or "").strip()
    root = agent_window_session_root()
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


def session_workspace(session_name: str) -> str | None:
    meta = read_session_meta(session_name)
    if meta is None:
        return None
    return meta["workspace"]


def session_meta_agents(session_name: str) -> list[str]:
    meta = read_session_meta(session_name)
    if meta is None:
        return []
    return meta.get("agents", [])


def set_session_workspace(session_name: str, workspace: str) -> None:
    name = str(session_name or "").strip()
    ws = str(workspace or "").strip()
    if not name or not ws:
        raise SessionMetaError("session name and workspace are required")
    path, raw = _existing_session_meta(name)
    owner = find_session_for_workspace(ws, exclude_session=name)
    if owner:
        raise SessionMetaError(f"A session already exists for this workspace: {owner}")
    raw["workspace"] = ws
    write_json_atomically(path, raw, indent=2)


def reset_session_agents(session_name: str) -> None:
    name = str(session_name or "").strip()
    if not name:
        raise SessionMetaError("session name is required")
    path, raw = _existing_session_meta(name)
    raw.pop("agents", None)
    write_json_atomically(path, raw, indent=2)


def write_session_meta_file(
    session_name: str,
    workspace: str,
    agents: list[str],
) -> None:
    write_json_atomically(
        session_meta_path(session_name),
        {"workspace": workspace, "agents": list(agents)},
        indent=2,
    )


def create_session_folder(session_name: str, workspace: str, agents: list[str]) -> None:
    session_artifact_dir(session_name).mkdir(parents=True)
    session_log_path(session_name).touch()
    write_session_meta_file(session_name, workspace, agents)
