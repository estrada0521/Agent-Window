from __future__ import annotations

import json
import os
import re
import time
import hashlib
import sys
from pathlib import Path


def _base_agent_name(name: str) -> str:
    """Strip instance suffix: 'claude-1' → 'claude', 'gemini' → 'gemini'."""
    return re.sub(r"-\d+$", "", name)


def _coerce_message_limit(raw: dict, fallback: int, cap: int) -> int:
    candidate = raw.get("message_limit")
    try:
        value = int(candidate)
    except Exception:
        value = fallback
    return max(10, min(cap, value))


HUB_SETTINGS_DEFAULTS = {
    "theme": "default",
    "agent_font_mode": "serif",
    "user_message_font": "preset-gothic",
    "agent_message_font": "preset-mincho",
    "user_message_opacity_blackhole": 1.0,
    "agent_message_opacity_blackhole": 1.0,
    "message_limit": 500,
    "chat_auto_mode": False,
    "chat_awake": False,
    "chat_sound": False,
    "chat_tts": False,
    "starfield": True,
}


def central_log_dir(repo_root: Path | str) -> Path:
    return Path(repo_root).resolve() / "logs"


def local_state_dir(repo_root: Path | str) -> Path:
    repo = str(Path(repo_root).resolve())
    repo_hash = hashlib.sha1(repo.encode("utf-8")).hexdigest()[:12]
    mac_root = Path.home() / "Library" / "Application Support" / "multiagent"
    xdg_root = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "multiagent"
    base = mac_root if sys.platform == "darwin" else xdg_root
    return base / repo_hash


def local_runtime_log_dir(repo_root: Path | str) -> Path:
    return local_state_dir(repo_root) / "logs"


def local_workspace_log_dir(repo_root: Path | str, workspace: Path | str) -> Path:
    workspace_real = str(Path(workspace).resolve())
    workspace_hash = hashlib.sha1(workspace_real.encode("utf-8")).hexdigest()[:12]
    name = Path(workspace_real).name or "workspace"
    return local_state_dir(repo_root) / "workspaces" / f"{name}-{workspace_hash}"


def hub_settings_path(repo_root: Path | str) -> Path:
    local_path = local_state_dir(repo_root) / ".hub-settings.json"
    legacy_path = central_log_dir(repo_root) / ".hub-settings.json"
    if not local_path.exists() and legacy_path.exists():
        local_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            local_path.write_text(legacy_path.read_text(encoding="utf-8"), encoding="utf-8")
        except Exception:
            pass
    return local_path


def thinking_stats_path(repo_root: Path | str) -> Path:
    local_path = local_state_dir(repo_root) / ".thinking-time.json"
    legacy_path = central_log_dir(repo_root) / ".thinking-time.json"
    local_path.parent.mkdir(parents=True, exist_ok=True)
    merged = {"sessions": {}, "daily": {}}
    saw_source = False
    for path in (legacy_path, local_path):
        if not path.exists():
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(raw, dict):
            continue
        saw_source = True
        sessions = raw.get("sessions")
        if isinstance(sessions, dict):
            session_items = sessions.items()
        else:
            session_items = [
                (key, value) for key, value in raw.items()
                if key != "daily" and isinstance(value, dict)
            ]
        for session_key, session_data in session_items:
            if not isinstance(session_data, dict):
                continue
            agents_raw = session_data.get("agents") if "agents" in session_data else session_data
            if not isinstance(agents_raw, dict):
                continue
            session_name = (session_data.get("session_name") or session_key.split("::", 1)[0] or session_key).strip()
            workspace = (session_data.get("workspace") or "").strip()
            canonical_key = _session_storage_key(session_name, workspace) if workspace else session_name
            target = merged["sessions"].setdefault(
                canonical_key,
                {
                    "session_name": session_name,
                    "workspace": workspace,
                    "updated_at": "",
                    "agents": {},
                },
            )
            updated_at = (session_data.get("updated_at") or "").strip()
            if updated_at > target.get("updated_at", ""):
                target["updated_at"] = updated_at
            if workspace and not target.get("workspace"):
                target["workspace"] = workspace
            for agent, raw_value in agents_raw.items():
                try:
                    value = max(0, int(raw_value or 0))
                except Exception:
                    value = 0
                base = _base_agent_name(agent)
                target["agents"][base] = max(target["agents"].get(base, 0), value)
        daily = raw.get("daily")
        if isinstance(daily, dict):
            for date_key, day_data in daily.items():
                if not isinstance(day_data, dict):
                    continue
                target_day = merged["daily"].setdefault(date_key, {})
                for agent, raw_value in day_data.items():
                    try:
                        value = max(0, int(raw_value or 0))
                    except Exception:
                        value = 0
                    base = _base_agent_name(agent)
                    target_day[base] = max(target_day.get(base, 0), value)
    if saw_source:
        try:
            local_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass
    return local_path


def thinking_stats_paths(repo_root: Path | str) -> list[Path]:
    path = thinking_stats_path(repo_root)
    return [path] if path.exists() else []


def _session_storage_key(session_name: str, workspace: str) -> str:
    workspace_real = str(Path(workspace or "").expanduser().resolve()) if workspace else ""
    return f"{session_name}::{workspace_real}"


def load_hub_settings(repo_root: Path | str, *, message_limit_cap: int = 500):
    settings = dict(HUB_SETTINGS_DEFAULTS)
    path = hub_settings_path(repo_root)
    if path.is_file():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            raw = {}
        if isinstance(raw, dict):
            theme = str(raw.get("theme") or settings["theme"]).strip().lower()
            if theme in {"default", "claude", "black-hole"}:
                settings["theme"] = theme
            agent_font_mode = str(raw.get("agent_font_mode") or settings["agent_font_mode"]).strip().lower()
            if agent_font_mode in {"serif", "gothic"}:
                settings["agent_font_mode"] = agent_font_mode
            user_message_font = str(raw.get("user_message_font") or settings["user_message_font"]).strip()
            if user_message_font:
                settings["user_message_font"] = user_message_font
            agent_message_font = str(raw.get("agent_message_font") or "").strip()
            if agent_message_font:
                settings["agent_message_font"] = agent_message_font
                if agent_message_font == "preset-gothic":
                    settings["agent_font_mode"] = "gothic"
                elif agent_message_font == "preset-mincho":
                    settings["agent_font_mode"] = "serif"
            else:
                settings["agent_message_font"] = "preset-gothic" if agent_font_mode == "gothic" else "preset-mincho"
            for key in ("user_message_opacity_blackhole", "agent_message_opacity_blackhole"):
                try:
                    value = float(raw.get(key, settings[key]))
                except Exception:
                    value = float(settings[key])
                settings[key] = max(0.2, min(1.0, value))
            settings["message_limit"] = _coerce_message_limit(raw, settings["message_limit"], message_limit_cap)
            for key in ("chat_auto_mode", "chat_awake", "chat_sound", "chat_tts", "starfield"):
                v = raw.get(key, settings[key])
                settings[key] = v in (True, "true", "1", "on") if not isinstance(v, bool) else v
    return settings


def save_hub_settings(repo_root: Path | str, raw, *, message_limit_cap: int = 500):
    settings = load_hub_settings(repo_root, message_limit_cap=message_limit_cap)
    theme = str(raw.get("theme") or settings["theme"]).strip().lower()
    if theme in {"default", "claude", "black-hole"}:
        settings["theme"] = theme
    agent_font_mode = str(raw.get("agent_font_mode") or settings["agent_font_mode"]).strip().lower()
    if agent_font_mode in {"serif", "gothic"}:
        settings["agent_font_mode"] = agent_font_mode
    user_message_font = str(raw.get("user_message_font") or settings["user_message_font"]).strip()
    if user_message_font:
        settings["user_message_font"] = user_message_font
    agent_message_font = str(raw.get("agent_message_font") or settings["agent_message_font"]).strip()
    if agent_message_font:
        settings["agent_message_font"] = agent_message_font
        if agent_message_font == "preset-gothic":
            settings["agent_font_mode"] = "gothic"
        elif agent_message_font == "preset-mincho":
            settings["agent_font_mode"] = "serif"
    for key in ("user_message_opacity_blackhole", "agent_message_opacity_blackhole"):
        try:
            value = float(raw.get(key, settings[key]))
        except Exception:
            value = float(settings[key])
        settings[key] = max(0.2, min(1.0, value))
    settings["message_limit"] = _coerce_message_limit(raw, settings["message_limit"], message_limit_cap)
    for key in ("chat_auto_mode", "chat_awake", "chat_sound", "chat_tts", "starfield"):
        if key in raw:
            v = raw.get(key)
            settings[key] = v in (True, "true", "1", "on") if not isinstance(v, bool) else v
        else:
            settings[key] = False
    path = hub_settings_path(repo_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
    return settings


def persist_thinking_totals(repo_root: Path | str, session_name: str, workspace: str, totals):
    agents = {}
    for agent in totals:
        try:
            value = int(totals.get(agent, 0) or 0)
        except Exception:
            value = 0
        base = _base_agent_name(agent)
        agents[base] = agents.get(base, 0) + max(0, value)
    path = thinking_stats_path(repo_root)
    payload = {}
    if path.is_file():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            payload = {}
    if not isinstance(payload, dict):
        payload = {}
    sessions = payload.get("sessions")
    if not isinstance(sessions, dict):
        sessions = {}
    # Compute delta vs previously stored values for this session (for daily tracking)
    prev_agents_raw = {}
    session_key = _session_storage_key(session_name, workspace)
    if session_key in sessions and isinstance(sessions[session_key].get("agents"), dict):
        prev_agents_raw = sessions[session_key]["agents"]
    # Aggregate previous values by base name for correct delta calculation
    prev_agents = {}
    for k, v in prev_agents_raw.items():
        base = _base_agent_name(k)
        prev_agents[base] = prev_agents.get(base, 0) + max(0, int(v or 0))
    today = time.strftime("%Y-%m-%d")
    daily = payload.get("daily")
    if not isinstance(daily, dict):
        daily = {}
    day_entry = daily.get(today)
    if not isinstance(day_entry, dict):
        day_entry = {}
    for agent in agents:
        new_val = agents.get(agent, 0)
        prev_val = max(0, int(prev_agents.get(agent, 0) or 0))
        delta = max(0, new_val - prev_val)
        if delta:
            day_entry[agent] = int(day_entry.get(agent, 0) or 0) + delta
        agents[agent] = max(prev_val, new_val)
    for agent, prev_val in prev_agents.items():
        if agent not in agents:
            agents[agent] = max(0, int(prev_val or 0))
    if day_entry:
        daily[today] = day_entry
    sessions[session_key] = {
        "session_name": session_name,
        "workspace": workspace,
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "agents": agents,
    }
    payload["sessions"] = sessions
    payload["daily"] = daily
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_hub_thinking_totals(repo_root: Path | str):
    totals = {}
    by_session = {}
    daily_thinking = {}
    session_agents = {}
    session_meta = {}
    for path in thinking_stats_paths(repo_root):
        if not path.is_file():
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            raw = {}
        if not isinstance(raw, dict):
            raw = {}
        sessions = raw.get("sessions")
        if isinstance(sessions, dict):
            session_items = sessions.items()
        else:
            # Legacy format: top-level keys are session names, values are agent→seconds maps.
            session_items = [
                (key, value) for key, value in raw.items()
                if key != "daily" and isinstance(value, dict)
            ]
        for session_key, session_data in session_items:
            if not isinstance(session_data, dict):
                continue
            agents = session_data.get("agents") if "agents" in session_data else session_data
            if not isinstance(agents, dict):
                continue
            display_name = (session_data.get("session_name") or session_key.split("::", 1)[0] or session_key).strip()
            workspace = (session_data.get("workspace") or "").strip()
            updated_at = (session_data.get("updated_at") or "").strip()
            if display_name not in session_agents:
                session_agents[display_name] = {}
                session_meta[display_name] = {"workspace": workspace, "updated_at": updated_at}
            else:
                if workspace and not session_meta[display_name].get("workspace"):
                    session_meta[display_name]["workspace"] = workspace
                if updated_at and updated_at > session_meta[display_name].get("updated_at", ""):
                    session_meta[display_name]["updated_at"] = updated_at
            for agent, raw_value in agents.items():
                try:
                    value = int(raw_value or 0)
                except Exception:
                    value = 0
                value = max(0, value)
                base = _base_agent_name(agent)
                session_agents[display_name][base] = max(session_agents[display_name].get(base, 0), value)
        daily_raw = raw.get("daily")
        if not isinstance(daily_raw, dict):
            daily_raw = {}
        for date_key, day_data in daily_raw.items():
            if not isinstance(day_data, dict):
                continue
            try:
                day_total = sum(max(0, int(v or 0)) for v in day_data.values())
            except Exception:
                continue
            if day_total:
                daily_thinking[date_key] = max(daily_thinking.get(date_key, 0), day_total)
    session_count = 0
    for display_name, agents in session_agents.items():
        session_total = 0
        used = False
        for agent, value in agents.items():
            value = max(0, int(value or 0))
            if value:
                used = True
            totals[agent] = totals.get(agent, 0) + value
            session_total += value
        if used:
            session_count += 1
            meta = session_meta.get(display_name, {})
            by_session[display_name] = {
                "seconds": session_total,
                "workspace": (meta.get("workspace") or "").strip(),
                "updated_at": (meta.get("updated_at") or "").strip(),
            }
    return {
        "total_seconds": sum(totals.values()),
        "by_agent": totals,
        "by_session": by_session,
        "session_count": session_count,
        "daily_thinking": daily_thinking,
    }
