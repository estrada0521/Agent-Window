from __future__ import annotations

from backend_core.access.settings import DEFAULT_MESSAGE_FONT, canonicalize_message_font
from backend_core.agents.registry import generate_agent_message_selectors


def font_family_stack(selection: str, role: str = "user") -> str:
    return canonicalize_message_font(selection)


def agent_detail_selectors(prefix: str = "") -> str:
    parts = []
    base = f"    {prefix}.message:not(.user):not(.system) .md-body"
    for suffix in (" p", " li", " h1", " h2", " h3", " h4", " blockquote"):
        parts.append(f"{base}{suffix}")
    return ",\n".join(parts)


def chat_font_settings_inline_style(
    settings: dict,
    *,
    font_family_stack_fn=font_family_stack,
) -> str:
    message_family = font_family_stack_fn(settings.get("message_font", DEFAULT_MESSAGE_FONT), "user")
    sans_family = DEFAULT_MESSAGE_FONT
    try:
        _legacy_size = max(8, min(18, int(settings.get("message_text_size", 13))))
    except Exception:
        _legacy_size = 13
    try:
        message_text_size_desktop = max(8, min(18, int(settings.get("message_text_size_desktop") or _legacy_size)))
    except Exception:
        message_text_size_desktop = _legacy_size
    message_max_width = 900

    mobile_body_weight_override = """
    html[data-mobile="1"] .message.user .md-body,
    html[data-mobile="1"] .message.user .md-body p,
    html[data-mobile="1"] .message.user .md-body li,
    html[data-mobile="1"] .message.user .md-body li p,
    html[data-mobile="1"] .message:not(.user):not(.system) .md-body,
    html[data-mobile="1"] .message:not(.user):not(.system) .md-body p,
    html[data-mobile="1"] .message:not(.user):not(.system) .md-body li,
    html[data-mobile="1"] .message:not(.user):not(.system) .md-body li p {
      font-weight: 430;
    }"""
    typography_override = """
    .message.user .md-body,
    .message.user .md-body p,
    .message.user .md-body li,
    .message.user .md-body li p {
      font-family: var(--user-message-font-family);
      font-weight: 400;
      font-optical-sizing: auto;
      font-variation-settings: "opsz" 16;
      font-synthesis: none;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      line-height: calc(var(--message-text-size, 16px) + 6px);
    }
    .message:not(.user):not(.system) .md-body,
    .message:not(.user):not(.system) .md-body p,
    .message:not(.user):not(.system) .md-body li,
    .message:not(.user):not(.system) .md-body li p {
      font-family: var(--agent-message-font-family);
      font-weight: 400;
      font-optical-sizing: auto;
      font-variation-settings: "opsz" 16;
      font-synthesis: none;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      line-height: calc(var(--message-text-size, 16px) + 8px);
    }"""
    return f"""
    :root {{
      --message-text-size: {message_text_size_desktop}px;
      --message-text-line-height: {message_text_size_desktop + 9}px;
      --message-max-width: {message_max_width}px;
      --message-font-family: {message_family};
      --user-message-font-family: var(--message-font-family);
      --agent-message-font-family: var(--message-font-family);
      --sans-font-family: {sans_family};
    }}
    .shell {{
      max-width: var(--message-max-width);
    }}
    .composer {{
      width: min(var(--composer-overlay-max-width, var(--message-max-width)), calc(100vw - 24px));
      max-width: var(--composer-overlay-max-width, var(--message-max-width));
    }}
    .composer-main-shell {{
      max-width: var(--composer-overlay-max-width, var(--message-max-width));
    }}
    .statusline {{
      width: min(var(--composer-overlay-max-width, var(--message-max-width)), calc(100vw - 16px));
    }}
    .message.user .md-body {{
      font-family: var(--user-message-font-family);
      color: var(--fg);
    }}
    .message.user .md-body h1,
    .message.user .md-body h2,
    .message.user .md-body h3,
    .message.user .md-body h4,
    .message.user .md-body blockquote {{
      color: var(--fg);
    }}
    {generate_agent_message_selectors(" .md-body")} {{
      font-family: var(--agent-message-font-family);
      color: var(--fg);
    }}
    {agent_detail_selectors(prefix="")} {{
      font-family: var(--agent-message-font-family);
      color: var(--fg);
    }}
    {typography_override}
    {mobile_body_weight_override}
    """
