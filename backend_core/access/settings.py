from __future__ import annotations

import hashlib
import json
import os
import socket
from pathlib import Path

SESSION_LOG_FILENAME = ".log.jsonl"
NATIVE_LOG_STATE_FILENAME = ".native-log-sync-state.json"
DESKTOP_THEME_CHOICES = frozenset({"system", "light", "dark"})


def normalize_theme_desktop(value: object) -> str:
    theme = str(value or "").strip().lower()
    return theme if theme in DESKTOP_THEME_CHOICES else "dark"


def resolve_hub_theme(settings: dict, *, variant: str) -> str:
    view = str(variant or "desktop").strip().lower()
    if view == "mobile":
        # Mobile always follows the OS preference; the server has no access
        # to it, so client-side code upgrades this fallback after load.
        return "dark"
    desktop = normalize_theme_desktop(settings.get("theme_desktop", settings.get("theme", "dark")))
    if desktop == "system":
        return "dark"
    return desktop


def resolve_chat_theme(settings: dict, *, variant: str) -> str:
    view = str(variant or "desktop").strip().lower()
    if view == "mobile":
        return "dark"
    desktop = normalize_theme_desktop(settings.get("theme_desktop", settings.get("theme", "dark")))
    if desktop == "system":
        return "dark"
    return desktop


def settings_for_hub_render(settings: dict, *, variant: str) -> dict:
    return dict(settings, theme=resolve_hub_theme(settings, variant=variant))


def settings_for_chat_render(settings: dict, *, variant: str) -> dict:
    return dict(settings, theme=resolve_chat_theme(settings, variant=variant))


def _apply_hub_settings(raw: dict, settings: dict, *, missing_flags_false: bool = False) -> dict:
    if not isinstance(raw, dict):
        return settings

    theme_raw = "dark" if missing_flags_false and "theme" not in raw else raw.get("theme")
    theme = str(theme_raw or settings.get("theme") or "dark").strip().lower()
    settings["theme"] = "light" if theme == "light" else "dark"

    if missing_flags_false and "theme_desktop" not in raw:
        # unchecked checkbox → dark
        settings["theme_desktop"] = "dark"
    elif raw.get("theme_desktop") is not None:
        settings["theme_desktop"] = normalize_theme_desktop(raw.get("theme_desktop"))
    else:
        # loading from file without this key → inherit global theme
        settings["theme_desktop"] = settings["theme"]

    # keep global theme in sync with desktop so hub renders correctly
    settings["theme"] = settings["theme_desktop"]

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
        settings["agent_message_font"] = "preset-gothic" if settings["agent_font_mode"] == "gothic" else "preset-mincho"

    try:
        message_text_size = int(raw.get("message_text_size", settings["message_text_size"]))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid message_text_size: {raw.get('message_text_size')!r}") from exc
    if not (8 <= message_text_size <= 18):
        raise ValueError(f"message_text_size out of range: {message_text_size}")
    settings["message_text_size"] = message_text_size

    try:
        message_text_size_desktop = int(
            raw.get("message_text_size_desktop")
            if raw.get("message_text_size_desktop") is not None
            else settings.get("message_text_size_desktop") or 13
        )
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid message_text_size_desktop: {raw.get('message_text_size_desktop')!r}") from exc
    if not (8 <= message_text_size_desktop <= 18):
        raise ValueError(f"message_text_size_desktop out of range: {message_text_size_desktop}")
    settings["message_text_size_desktop"] = message_text_size_desktop

    return settings


HUB_SETTINGS_DEFAULTS = {
    "theme": "dark",
    "theme_desktop": "dark",
    "agent_font_mode": "serif",
    "user_message_font": "preset-gothic",
    "agent_message_font": "preset-mincho",
    "message_text_size": 13,
    "message_text_size_desktop": 13,
}


def agent_window_root() -> Path:
    return Path.home() / ".agent-window"


def agent_window_state_dir() -> Path:
    override = (os.environ.get("AGENT_WINDOW_STATE_DIR") or "").strip()
    if override:
        return Path(override).expanduser()
    return agent_window_root() / "state"


def pwa_https_enabled() -> bool:
    return (agent_window_state_dir() / "pwa" / "enabled").is_file()


def local_bind_scheme(*, cert_file: str = "", key_file: str = "") -> str:
    """PWA on → HTTPS only. PWA off → HTTP."""
    if not pwa_https_enabled():
        return "http"
    if not cert_file or not key_file:
        raise SystemExit("PWA is enabled; HTTPS certificate and key are required")
    if not Path(cert_file).is_file() or not Path(key_file).is_file():
        raise SystemExit("PWA is enabled; HTTPS certificate files are missing")
    return "https"


def agent_window_run_dir() -> Path:
    return agent_window_root() / "run"


def agent_window_session_root() -> Path:
    return agent_window_root() / "session"


def local_state_dir(repo_root: Path | str | None = None) -> Path:
    return agent_window_state_dir()


def local_runtime_log_dir(repo_root: Path | str | None = None) -> Path:
    return agent_window_session_root()


def session_artifact_dir(session_name: str) -> Path:
    return agent_window_session_root() / str(session_name or "").strip()


def session_log_path(session_name: str) -> Path:
    return session_artifact_dir(session_name) / SESSION_LOG_FILENAME


def session_native_log_state_path(session_name: str) -> Path:
    return session_artifact_dir(session_name) / NATIVE_LOG_STATE_FILENAME


def workspace_agent_window_dir(workspace: Path | str) -> Path:
    return Path(workspace).expanduser() / ".agent-window"


def workspace_log_link_path(workspace: Path | str) -> Path:
    return workspace_agent_window_dir(workspace) / SESSION_LOG_FILENAME


def workspace_native_log_state_link_path(workspace: Path | str) -> Path:
    return workspace_agent_window_dir(workspace) / NATIVE_LOG_STATE_FILENAME


def ensure_session_workspace_mirrors(session_name: str, workspace: Path | str) -> None:
    if not workspace:
        return
    mirrors = (
        (session_log_path(session_name), workspace_log_link_path(workspace)),
        (session_native_log_state_path(session_name), workspace_native_log_state_link_path(workspace)),
    )
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


def default_chat_port(session_name: str) -> int:
    digest = int(hashlib.md5(session_name.encode()).hexdigest(), 16)
    return 8200 + (digest % 700)


def chat_ports_path(repo_root: Path | str, *, create_parent: bool = True) -> Path:
    path = local_state_dir(repo_root) / ".chat-ports.json"
    if create_parent:
        path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _read_json_dict(path: Path) -> dict:
    if not path.is_file():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"invalid json object: {path}")
    return raw


def load_chat_port_overrides(repo_root: Path | str) -> dict[str, int]:
    raw = _read_json_dict(chat_ports_path(repo_root, create_parent=False))
    overrides = {}
    for key, value in raw.items():
        if not isinstance(key, str):
            raise ValueError(f"invalid chat port key: {key!r}")
        try:
            port = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"invalid chat port for {key!r}: {value!r}") from exc
        if not (1 <= port <= 65535):
            raise ValueError(f"chat port out of range for {key!r}: {port}")
        overrides[key] = port
    return overrides


def resolve_chat_port(repo_root: Path | str, session_name: str) -> int:
    return int(load_chat_port_overrides(repo_root).get(session_name) or default_chat_port(session_name))


def save_chat_port_override(repo_root: Path | str, session_name: str, port: int) -> None:
    overrides = load_chat_port_overrides(repo_root)
    overrides[str(session_name)] = int(port)
    chat_ports_path(repo_root).write_text(json.dumps(overrides, ensure_ascii=False, indent=2), encoding="utf-8")


def port_is_bindable(port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("0.0.0.0", int(port)))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def hub_settings_path(repo_root: Path | str) -> Path:
    local_path = local_state_dir(repo_root) / ".hub-settings.json"
    local_path.parent.mkdir(parents=True, exist_ok=True)
    return local_path


def load_hub_settings(repo_root: Path | str) -> dict:
    settings = dict(HUB_SETTINGS_DEFAULTS)
    path = hub_settings_path(repo_root)
    if path.is_file():
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"invalid hub settings: {path}")
        settings = _apply_hub_settings(raw, settings)
    return settings


def save_hub_settings(repo_root: Path | str, raw: dict) -> dict:
    settings = load_hub_settings(repo_root)
    settings = _apply_hub_settings(raw, settings, missing_flags_false=True)
    path = hub_settings_path(repo_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
    return settings
