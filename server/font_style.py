from __future__ import annotations

from backend_core.access.settings import canonicalize_message_font
from backend_core.agents.registry import generate_agent_message_selectors


def font_family_stack(selection: str) -> str:
    return canonicalize_message_font(selection)


def agent_detail_selectors(prefix: str = "") -> str:
    parts = []
    base = f"    {prefix}.message:not(.user):not(.system) .md-body"
    for suffix in (" p", " li", " h1", " h2", " h3", " h4", " blockquote"):
        parts.append(f"{base}{suffix}")
    return ",\n".join(parts)


def body_typography_css() -> str:
    """Message-body font weight/rendering rules, shared by chat and the
    markdown/file preview viewer so the two never render text differently.
    Depends only on --font-main and --text-size, both already defined
    independently by each caller's own :root block."""
    body_weight_tokens = """
    html[data-theme="dark"] {
      --body-weight: 300;
    }
    html[data-theme="light"] {
      --body-weight: 400;
    }
    html[data-mobile="1"][data-theme="light"] {
      --body-weight: 430;
    }"""
    # Every message role (user, agent, sysmsg) and the standalone preview
    # viewer render body text identically, line-height included.
    typography_override = """
    .message.user .md-body,
    .message.user .md-body p,
    .message.user .md-body li,
    .message.user .md-body li p,
    .message:not(.user):not(.system) .md-body,
    .message:not(.user):not(.system) .md-body p,
    .message:not(.user):not(.system) .md-body li,
    .message:not(.user):not(.system) .md-body li p,
    .sysmsg-text,
    .md-body,
    .md-body p,
    .md-body li,
    .md-body li p,
    .md-body blockquote,
    .md-body blockquote p {
      font-family: var(--font-main);
      font-weight: var(--body-weight);
      font-optical-sizing: auto;
      font-variation-settings: "opsz" 16;
      font-synthesis: none;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    .message.user .md-body,
    .message.user .md-body p,
    .message.user .md-body li,
    .message.user .md-body li p,
    .message:not(.user):not(.system) .md-body,
    .message:not(.user):not(.system) .md-body p,
    .message:not(.user):not(.system) .md-body li,
    .message:not(.user):not(.system) .md-body li p,
    .md-body,
    .md-body p,
    .md-body li,
    .md-body li p,
    .md-body blockquote,
    .md-body blockquote p {
      line-height: calc(var(--text-size, 16px) + 8px);
    }"""
    return body_weight_tokens + typography_override


def chat_font_settings_inline_style(settings: dict) -> str:
    message_family = font_family_stack(settings.get("message_font", ""))
    code_family = settings.get("code_font", "")
    try:
        text_size = int(settings.get("text_size", 13))
    except Exception:
        text_size = 13
    message_max_width = 640
    return f"""
    :root {{
      --text-size: {text_size}px;
      --text-line-height: {text_size + 9}px;
      --message-max-width: {message_max_width}px;
      --font-main: {message_family};
      --font-code: {code_family};
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
      font-family: var(--font-main);
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
      font-family: var(--font-main);
      color: var(--fg);
    }}
    {agent_detail_selectors(prefix="")} {{
      font-family: var(--font-main);
      color: var(--fg);
    }}
    {body_typography_css()}
    """
