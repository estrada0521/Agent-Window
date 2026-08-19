from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from backend_core.access.settings import agent_window_session_root


def find_session_for_workspace(workspace: Path | str, *, exclude_session: str = "") -> str | None:
    """Return the name of an existing session (active or archived) whose
    recorded workspace matches. A session's .meta file persists after the
    tmux session itself is gone, so this covers archived sessions too.
    """
    target = str(Path(workspace).expanduser().resolve())
    exclude = str(exclude_session or "").strip()
    root = agent_window_session_root()
    if not root.is_dir():
        return None
    for entry in sorted(root.iterdir()):
        if not entry.is_dir() or entry.name == exclude:
            continue
        meta_path = entry / ".meta"
        if not meta_path.is_file():
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(meta, dict) and str(meta.get("workspace") or "").strip() == target:
            return entry.name
    return None


def _parse_tmux_environment_output(output: str) -> dict[str, str]:
    env_map: dict[str, str] = {}
    for raw in (output or "").splitlines():
        line = raw.strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        env_map[key] = value
    return env_map


def _parse_agents_csv(agents_csv: str) -> list[str]:
    return [
        item.strip()
        for item in (agents_csv or "").split(",")
        if item.strip() and item.strip() != "-"
    ]


def _reconcile_agent_names(
    meta: dict[str, object],
    current_agents: list[str],
    *,
    rename: tuple[str, str] | None = None,
) -> None:
    raw_names = meta.get("agent_names")
    if raw_names is None:
        return
    if not isinstance(raw_names, dict):
        raise ValueError("agent_names must be an object")
    if rename:
        old_key = str(rename[0] or "").strip().lower()
        new_key = str(rename[1] or "").strip().lower()
        if old_key and new_key and old_key in raw_names and new_key not in raw_names:
            raw_names = {**raw_names, new_key: raw_names[old_key]}
    current = {str(agent or "").strip().lower() for agent in current_agents if str(agent or "").strip()}
    reconciled = {
        str(canonical or "").strip().lower(): str(display or "").strip()
        for canonical, display in raw_names.items()
        if str(canonical or "").strip() and str(display or "").strip()
        and str(canonical or "").strip().lower() in current
    }
    if reconciled:
        meta["agent_names"] = reconciled
    else:
        meta.pop("agent_names", None)


def write_session_meta_file(
    session: str,
    agents_csv: str,
    tmux_env_output: str,
    *,
    rename: tuple[str, str] | None = None,
) -> None:
    env_map = _parse_tmux_environment_output(tmux_env_output)
    index_path_raw = str(env_map.get("AGENT_WINDOW_INDEX_PATH") or "").strip()
    if not index_path_raw:
        raise ValueError("AGENT_WINDOW_INDEX_PATH is required to write session meta")
    workspace = str(env_map.get("AGENT_WINDOW_WORKSPACE") or "").strip()
    if not workspace:
        raise ValueError("AGENT_WINDOW_WORKSPACE is required to write session meta")

    meta_path = Path(index_path_raw).expanduser().resolve().parent / ".meta"
    updated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    meta: dict[str, object] = {}
    if meta_path.is_file():
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"invalid session meta: {meta_path}")
        meta = raw

    created_at = str(meta.get("created_at") or "").strip() or updated_at

    parsed_agents = _parse_agents_csv(agents_csv)
    _reconcile_agent_names(meta, parsed_agents, rename=rename)
    meta["session"] = session
    meta["workspace"] = workspace
    meta["agents"] = parsed_agents
    meta["created_at"] = created_at
    meta["updated_at"] = updated_at
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
