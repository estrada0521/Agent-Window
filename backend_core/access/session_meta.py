from __future__ import annotations

import json
from pathlib import Path

from backend_core.access.atomic_json import write_json_atomically
from backend_core.access.settings import agent_window_session_root


class SessionMetaError(ValueError):
    pass


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
    for entry in sorted(root.iterdir()):
        if not entry.is_dir() or entry.name == exclude:
            continue
        workspace = session_workspace(entry.name)
        if not workspace:
            continue
        normalized = str(Path(workspace).expanduser().resolve())
        if normalized in claims:
            raise SessionMetaError(
                f"workspace {normalized} is claimed by both {claims[normalized][0]} and {entry.name}"
            )
        claims[normalized] = (entry.name, workspace)
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
    meta_path = agent_window_session_root() / str(session_name or "").strip() / ".meta"
    if not meta_path.is_file():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SessionMetaError(f"invalid session meta: {meta_path}") from exc
    if not isinstance(meta, dict):
        raise SessionMetaError(f"invalid session meta: {meta_path}")
    return str(meta.get("workspace") or "").strip() or None


def session_meta_agents(session_name: str) -> list[str]:
    """The agent list a session's .meta records. The composer's target row
    shows these for an archived session so the topology is visible before a
    revive; an unreadable or missing .meta just yields none.
    """
    meta_path = agent_window_session_root() / str(session_name or "").strip() / ".meta"
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    raw = meta.get("agents") if isinstance(meta, dict) else None
    if not isinstance(raw, list):
        return []
    return [str(a).strip() for a in raw if str(a).strip()]


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
    meta_path = agent_window_session_root() / name / ".meta"
    if not meta_path.is_file():
        raise SessionMetaError(f"session not found: {name}")
    try:
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SessionMetaError(f"invalid session meta: {meta_path}") from exc
    if not isinstance(raw, dict):
        raise SessionMetaError(f"invalid session meta: {meta_path}")
    owner = find_session_for_workspace(ws, exclude_session=name)
    if owner:
        raise SessionMetaError(f"A session already exists for this workspace: {owner}")
    raw["workspace"] = ws
    write_json_atomically(meta_path, raw, indent=2)


def reset_session_agents(session_name: str) -> None:
    """Drop the recorded agent list from a session's .meta.

    Offered for any archived session; a later revive starts without the old
    agent set. Like set_session_workspace, this touches nothing else.
    """
    name = str(session_name or "").strip()
    if not name:
        raise SessionMetaError("session name is required")
    meta_path = agent_window_session_root() / name / ".meta"
    if not meta_path.is_file():
        raise SessionMetaError(f"session not found: {name}")
    try:
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SessionMetaError(f"invalid session meta: {meta_path}") from exc
    if not isinstance(raw, dict):
        raise SessionMetaError(f"invalid session meta: {meta_path}")
    raw.pop("agents", None)
    write_json_atomically(meta_path, raw, indent=2)


def write_session_meta_file(
    session_name: str,
    workspace: str,
    agents: list[str],
) -> None:
    recorded_workspace = str(workspace or "").strip()
    if not recorded_workspace:
        raise ValueError("workspace is required to write session meta")

    meta_path = agent_window_session_root() / str(session_name or "").strip() / ".meta"
    meta = {
        "workspace": recorded_workspace,
        "agents": [str(agent).strip() for agent in agents if str(agent).strip()],
    }
    write_json_atomically(meta_path, meta, indent=2)
