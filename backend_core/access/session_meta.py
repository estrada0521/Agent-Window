from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path


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


def _reconcile_agent_names(meta: dict[str, object], current_agents: list[str]) -> None:
    raw_names = meta.get("agent_names")
    if not isinstance(raw_names, dict):
        return
    previous_agents_raw = meta.get("agents")
    previous_agents = {
        str(agent or "").strip().lower()
        for agent in (previous_agents_raw if isinstance(previous_agents_raw, list) else [])
        if str(agent or "").strip()
    }
    current = {str(agent or "").strip().lower() for agent in current_agents if str(agent or "").strip()}
    cleaned = {
        str(canonical or "").strip().lower(): str(display or "").strip()
        for canonical, display in raw_names.items()
        if str(canonical or "").strip() and str(display or "").strip()
    }
    reconciled = {canonical: display for canonical, display in cleaned.items() if canonical in current}
    for canonical, display in cleaned.items():
        if canonical in current or canonical not in previous_agents or re.search(r"-\d+$", canonical):
            continue
        replacement = f"{canonical}-1"
        if replacement in current and replacement not in previous_agents and replacement not in reconciled:
            reconciled[replacement] = display
    if reconciled:
        meta["agent_names"] = reconciled
    else:
        meta.pop("agent_names", None)


def write_session_meta_file(session: str, agents_csv: str, tmux_env_output: str) -> None:
    env_map = _parse_tmux_environment_output(tmux_env_output)
    index_path_raw = str(env_map.get("AGENT_WINDOW_INDEX_PATH") or "").strip()
    if not index_path_raw:
        return

    meta_path = Path(index_path_raw).expanduser().resolve().parent / ".meta"
    updated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    meta: dict[str, object] = {}
    if meta_path.is_file():
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"invalid session meta: {meta_path}")
        meta = raw

    created_at = str(meta.get("created_at") or "").strip() or updated_at
    workspace = str(
        env_map.get("AGENT_WINDOW_WORKSPACE")
        or meta.get("workspace")
        or ""
    ).strip()

    parsed_agents = _parse_agents_csv(agents_csv)
    _reconcile_agent_names(meta, parsed_agents)
    meta["session"] = session
    meta["workspace"] = workspace
    meta["agents"] = parsed_agents
    meta["created_at"] = created_at
    meta["updated_at"] = updated_at
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
