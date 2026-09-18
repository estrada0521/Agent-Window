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
    """Map each normalized workspace to its session and recorded path."""
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
    """Return the name of an existing session (active or archived) whose
    recorded workspace matches. A session's .meta file persists after the
    tmux session itself is gone, so this covers archived sessions too.
    """
    target = str(Path(workspace).expanduser().resolve())
    claim = session_workspace_claims(exclude_session=exclude_session).get(target)
    return claim[0] if claim else None


def session_workspace(session_name: str) -> str | None:
    """Return the workspace path recorded in a session's own .meta file.

    Used to resolve which live tmux session (if any) is currently backing
    an AW session: tmux only ever knows its own workspace, never an AW
    session's name, so the .meta-recorded workspace is the bridge between
    the two.
    """
    meta = read_session_meta(session_name)
    if meta is None:
        return None
    return meta["workspace"]


def session_meta_agents(session_name: str) -> list[str]:
    """The agent list a session's .meta records."""
    meta = read_session_meta(session_name)
    if meta is None:
        return []
    return meta.get("agents", [])


def set_session_workspace(session_name: str, workspace: str) -> None:
    """Overwrite just the workspace path in a session's .meta.

    Nothing else: the port a viewer derives from the workspace only matters
    for a session that's currently open, and Change Workspace is offered only
    for an archived session that isn't. Workspace ownership remains unique
    across active and archived sessions.
    """
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
    """Drop the recorded agent list from a session's .meta.

    Offered for any archived session; a later revive starts without the old
    agent set. Like set_session_workspace, this touches nothing else.
    """
    name = str(session_name or "").strip()
    if not name:
        raise SessionMetaError("session name is required")
    path, raw = _existing_session_meta(name)
    raw.pop("agents", None)
    write_json_atomically(path, raw, indent=2)


def _meta_document(workspace: str, agents: list[str]) -> dict:
    recorded_workspace = str(workspace or "").strip()
    if not recorded_workspace:
        raise ValueError("workspace is required to write session meta")
    return {
        "workspace": recorded_workspace,
        "agents": [str(agent).strip() for agent in agents if str(agent).strip()],
    }


def write_session_meta_file(
    session_name: str,
    workspace: str,
    agents: list[str],
) -> None:
    write_json_atomically(session_meta_path(session_name), _meta_document(workspace, agents), indent=2)


def create_session_folder(session_name: str, workspace: str, agents: list[str]) -> None:
    document = _meta_document(workspace, agents)
    session_artifact_dir(session_name).mkdir(parents=True)
    session_log_path(session_name).touch()
    write_json_atomically(session_meta_path(session_name), document, indent=2)
