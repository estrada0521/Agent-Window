from __future__ import annotations

import hashlib
import json
import os
import re
import socket
from pathlib import Path

from backend_core.access.atomic_json import write_json_atomically

SESSION_LOG_FILENAME = ".log.jsonl"
NATIVE_LOG_STATE_FILENAME = ".native-log-sync-state.json"
THEME_CHOICES = frozenset({"system", "light", "dark"})
SESSION_NAME_MAX_LENGTH = 64
DEFAULT_MESSAGE_FONT = (
    '"anthropicSans", "Anthropic Sans", "SF Pro Text", "Segoe UI", '
    '"Hiragino Sans", "Yu Gothic", Meiryo, "Noto Sans CJK JP", '
    '"PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", '
    '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", '
    '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", sans-serif'
)
DEFAULT_CODE_FONT = (
    '"SF Mono", "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace'
)


def sanitize_session_name(raw: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.\-]", "-", str(raw or "")).strip(".-")[:SESSION_NAME_MAX_LENGTH]


def normalize_theme_choice(value: object) -> str:
    theme = str(value or "").strip().lower()
    return theme if theme in THEME_CHOICES else "dark"


def resolve_theme(settings: dict, *, variant: str) -> str:
    view = str(variant or "desktop").strip().lower()
    if view == "mobile":
        mobile = normalize_theme_choice(settings.get("theme_mobile", "system"))
        if mobile in ("light", "dark"):
            return mobile
        # "system": the server has no access to the client's OS preference,
        # so client-side code upgrades this fallback after load.
        return "dark"
    desktop = normalize_theme_choice(settings.get("theme_desktop", "dark"))
    if desktop == "system":
        return "dark"
    return desktop


def canonicalize_message_font(value: object) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        return ""
    if text == "preset-gothic":
        return DEFAULT_MESSAGE_FONT
    if text.startswith("system:"):
        family = text.split(":", 1)[1].strip()
        if family:
            return f'"{family}", {DEFAULT_MESSAGE_FONT}'
        return ""
    return text


def _with_derived_font_fields(settings: dict) -> dict:
    settings["message_font"] = canonicalize_message_font(settings.get("message_font"))
    code_font = str(settings.get("code_font") or "").strip()
    settings["code_font"] = code_font if code_font else DEFAULT_CODE_FONT
    return settings


def apply_font_tokens(text: str, settings: dict | None = None) -> str:
    import html

    message_font_css = canonicalize_message_font((settings or {}).get("message_font"))
    message_font = html.escape(message_font_css)
    code_font_css = str((settings or {}).get("code_font") or "").strip() or DEFAULT_CODE_FONT
    code_font = html.escape(code_font_css)
    replacements = (
        ("__MESSAGE_FONT_CSS__", message_font_css),
        ("__CODE_FONT_CSS__", code_font_css),
        ("__MESSAGE_FONT__", message_font),
        ("__CODE_FONT__", code_font),
    )
    resolved = text
    for old, new in replacements:
        resolved = resolved.replace(old, new)
    return resolved


def settings_for_hub_render(settings: dict, *, variant: str) -> dict:
    view = str(variant or "desktop").strip().lower()
    rendered = dict(settings, theme=resolve_theme(settings, variant=view))
    if view == "mobile":
        rendered.update(MOBILE_CHAT_TEXT_SIZE)
    return _with_derived_font_fields(rendered)


def settings_for_chat_render(settings: dict, *, variant: str) -> dict:
    view = str(variant or "desktop").strip().lower()
    rendered = dict(settings, theme=resolve_theme(settings, variant=view))
    if view == "mobile":
        rendered.update(MOBILE_CHAT_TEXT_SIZE)
    return _with_derived_font_fields(rendered)


def _apply_hub_settings(raw: dict, settings: dict) -> dict:
    if not isinstance(raw, dict):
        return settings

    if raw.get("theme_desktop") is not None:
        settings["theme_desktop"] = normalize_theme_choice(raw.get("theme_desktop"))

    if raw.get("theme_mobile") is not None:
        settings["theme_mobile"] = normalize_theme_choice(raw.get("theme_mobile"))

    if "message_font" in raw:
        message_font = canonicalize_message_font(raw.get("message_font"))
    else:
        message_font = canonicalize_message_font(settings.get("message_font"))
    settings["message_font"] = message_font

    if "code_font" in raw:
        code_font = str(raw.get("code_font") or "").strip()
        if code_font:
            settings["code_font"] = code_font
        else:
            settings["code_font"] = DEFAULT_CODE_FONT
    elif "code_font" not in settings:
        settings["code_font"] = DEFAULT_CODE_FONT

    try:
        text_size = int(raw.get("text_size", settings.get("text_size") or 13))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid text_size: {raw.get('text_size')!r}") from exc
    settings["text_size"] = text_size

    return settings


HUB_SETTINGS_DEFAULTS = {
    "theme_desktop": "dark",
    "theme_mobile": "system",
    "message_font": DEFAULT_MESSAGE_FONT,
    "code_font": DEFAULT_CODE_FONT,
    "text_size": 13,
}

MOBILE_CHAT_TEXT_SIZE = {
    "text_size": 13,
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


def local_bind_host() -> str:
    """PWA on → LAN. PWA off → loopback."""
    return "0.0.0.0" if pwa_https_enabled() else "127.0.0.1"


def agent_window_run_dir() -> Path:
    return agent_window_root() / "run"


def agent_window_session_root() -> Path:
    return agent_window_root() / "session"


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
    raw = str(workspace or "").strip()
    if not raw:
        return
    workspace_path = Path(raw).expanduser()
    if not workspace_path.is_dir():
        return
    mirrors = (
        (session_log_path(session_name), workspace_log_link_path(workspace_path)),
        (session_native_log_state_path(session_name), workspace_native_log_state_link_path(workspace_path)),
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


def workspace_chat_port(workspace: Path | str) -> int:
    # 30000-48999: wide enough that a real collision with another program
    # is rare, inside the IANA "registered" range so it needs no elevated
    # privileges, clear of both the low end (where nearly every dev tool's
    # conventional default port lives -- 3000, 5432, 6379, 8080, 8888...)
    # and the 49152+ dynamic/ephemeral range OS-assigned ports come from.
    canonical_workspace = str(Path(workspace).expanduser().resolve())
    digest = int(hashlib.md5(canonical_workspace.encode()).hexdigest(), 16)
    return 30000 + (digest % 19000)


def port_is_bindable(port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((local_bind_host(), int(port)))
        return True
    except OSError:
        return False
    finally:
        sock.close()



def hub_settings_path() -> Path:
    local_path = agent_window_state_dir() / ".hub-settings.json"
    local_path.parent.mkdir(parents=True, exist_ok=True)
    return local_path


def load_hub_settings() -> dict:
    settings = dict(HUB_SETTINGS_DEFAULTS)
    path = hub_settings_path()
    if path.is_file():
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"invalid hub settings: {path}")
        settings = _apply_hub_settings(raw, settings)
    return settings


def save_hub_settings(raw: dict) -> dict:
    settings = load_hub_settings()
    settings = _apply_hub_settings(raw, settings)
    path = hub_settings_path()
    write_json_atomically(path, settings, indent=2)
    return settings
