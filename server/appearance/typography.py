from __future__ import annotations

from fs.log.paths import agent_window_root

DESKTOP_TEXT_SIZE = 13
MOBILE_TEXT_SIZE = 13
TEXT_SIZE_MIN = 8
TEXT_SIZE_MAX = 24
TEXT_LINE_HEIGHT_RATIO = 1.62
MESSAGE_MAX_WIDTH_EM = 49.2

DESKTOP_LIGHT_BODY_WEIGHT = 400
DESKTOP_DARK_BODY_WEIGHT = 300
DESKTOP_DARK_USER_BODY_WEIGHT = 400
MOBILE_LIGHT_BODY_WEIGHT = 420
MOBILE_DARK_BODY_WEIGHT = 300

DESKTOP_LIGHT_STRONG_WEIGHT = 600
DESKTOP_DARK_STRONG_WEIGHT = 600
MOBILE_LIGHT_STRONG_WEIGHT = 650
MOBILE_DARK_STRONG_WEIGHT = 600

DESKTOP_LIGHT_LINK_WEIGHT = 600
DESKTOP_DARK_LINK_WEIGHT = 400
MOBILE_LIGHT_LINK_WEIGHT = 650
MOBILE_DARK_LINK_WEIGHT = 500

MD_HEADING_LIGHT_WEIGHT = 600
MD_HEADING_DARK_WEIGHT = 550
MD_FRONTMATTER_KEY_WEIGHT = 650

DESKTOP_LIGHT_CODE_WEIGHT = 400
DESKTOP_DARK_CODE_WEIGHT = 300
MOBILE_LIGHT_CODE_WEIGHT = 500
MOBILE_DARK_CODE_WEIGHT = 300
CODE_BLOCK_LINE_HEIGHT_RATIO = 1.35

MOBILE_DARK_INLINE_CODE_WEIGHT = 400

FILE_PREVIEW_CODE_TEXT_SIZE = 12
FILE_PREVIEW_CODE_LINE_HEIGHT_RATIO = 1.35
FILE_PREVIEW_LINE_NUMBER_LIGHT_CHANNELS = "100, 100, 100"
MOBILE_LIGHT_FILE_PREVIEW_CODE_WEIGHT = 500
MOBILE_DARK_FILE_PREVIEW_CODE_WEIGHT = 300

MOBILE_GIT_DIFF_CODE_TEXT_SIZE = 11.5
GIT_DIFF_CODE_TEXT_SIZE = MOBILE_GIT_DIFF_CODE_TEXT_SIZE
GIT_DIFF_CODE_LINE_HEIGHT_RATIO = FILE_PREVIEW_CODE_LINE_HEIGHT_RATIO


def clamp_text_size(value: object) -> int:
    size = int(value)
    return max(TEXT_SIZE_MIN, min(TEXT_SIZE_MAX, size))


def text_line_height_px(text_size: object) -> float:
    return float(text_size) * TEXT_LINE_HEIGHT_RATIO


def apply_font_tokens(text: str) -> str:
    replacements = (
        ("__MOBILE_LIGHT_BODY_WEIGHT__", str(MOBILE_LIGHT_BODY_WEIGHT)),
        ("__MOBILE_DARK_BODY_WEIGHT__", str(MOBILE_DARK_BODY_WEIGHT)),
    )
    resolved = text
    for old, new in replacements:
        resolved = resolved.replace(old, new)
    if "__CUSTOM_FONT_CSS__" in resolved:
        path = agent_window_root() / "fonts.css"
        css = path.read_text(encoding="utf-8") if path.is_symlink() or path.exists() else ""
        resolved = resolved.replace("__CUSTOM_FONT_CSS__", css)
    return resolved


def agent_detail_selectors(prefix: str = "") -> str:
    parts = []
    base = f"    {prefix}.message:not(.user):not(.system) .md-body"
    for suffix in (" p", " li", " h1", " h2", " h3", " h4", " blockquote"):
        parts.append(f"{base}{suffix}")
    return ",\n".join(parts)


def body_typography_css() -> str:
    body_weight_tokens = f"""
    :root {{
      --code-block-line-height: {CODE_BLOCK_LINE_HEIGHT_RATIO:g};
    }}
    html:not([data-mobile="1"])[data-theme="dark"] {{
      --body-weight: {DESKTOP_DARK_BODY_WEIGHT};
      --code-weight: {DESKTOP_DARK_CODE_WEIGHT};
      --inline-code-weight: var(--code-weight);
      --link-weight: {DESKTOP_DARK_LINK_WEIGHT};
      --md-strong-weight: {DESKTOP_DARK_STRONG_WEIGHT};
      --md-heading-weight: {MD_HEADING_DARK_WEIGHT};
    }}
    html:not([data-mobile="1"])[data-theme="light"],
    html:not([data-mobile="1"])[data-theme="dark"] .message.user .message-body-row {{
      --body-weight: {DESKTOP_LIGHT_BODY_WEIGHT};
      --code-weight: {DESKTOP_LIGHT_CODE_WEIGHT};
      --inline-code-weight: var(--code-weight);
      --link-weight: {DESKTOP_LIGHT_LINK_WEIGHT};
      --md-strong-weight: {DESKTOP_LIGHT_STRONG_WEIGHT};
      --md-heading-weight: {MD_HEADING_LIGHT_WEIGHT};
    }}
    html:not([data-mobile="1"])[data-theme="dark"] .message.user .message-body-row {{
      --body-weight: {DESKTOP_DARK_USER_BODY_WEIGHT};
    }}
    html[data-mobile="1"][data-theme="light"],
    html[data-mobile="1"][data-theme="dark"] .message.user .message-body-row {{
      --body-weight: {MOBILE_LIGHT_BODY_WEIGHT};
      --code-weight: {MOBILE_LIGHT_CODE_WEIGHT};
      --inline-code-weight: var(--code-weight);
      --file-preview-code-weight: {MOBILE_LIGHT_FILE_PREVIEW_CODE_WEIGHT};
      --link-weight: {MOBILE_LIGHT_LINK_WEIGHT};
      --md-strong-weight: {MOBILE_LIGHT_STRONG_WEIGHT};
      --md-heading-weight: {MD_HEADING_LIGHT_WEIGHT};
    }}
    html[data-mobile="1"][data-theme="dark"],
    html[data-mobile="1"] #paneTracePanel,
    html[data-mobile="1"] .pane-viewer {{
      --body-weight: {MOBILE_DARK_BODY_WEIGHT};
      --code-weight: {MOBILE_DARK_CODE_WEIGHT};
      --inline-code-weight: {MOBILE_DARK_INLINE_CODE_WEIGHT};
      --file-preview-code-weight: {MOBILE_DARK_FILE_PREVIEW_CODE_WEIGHT};
      --link-weight: {MOBILE_DARK_LINK_WEIGHT};
      --md-strong-weight: {MOBILE_DARK_STRONG_WEIGHT};
      --md-heading-weight: {MD_HEADING_DARK_WEIGHT};
    }}"""
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
    .message-time,
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
    """
    return body_weight_tokens + typography_override


def timeline_font_style(*, text_size: object = DESKTOP_TEXT_SIZE) -> str:
    size = clamp_text_size(text_size)
    return f"""
    :root {{
      --text-size: {size}px;
      --text-line-height: {TEXT_LINE_HEIGHT_RATIO:g};
      --message-max-width: {MESSAGE_MAX_WIDTH_EM:g}em;
      --md-frontmatter-key-weight: {MD_FRONTMATTER_KEY_WEIGHT};
      --git-diff-code-size: {GIT_DIFF_CODE_TEXT_SIZE}px;
      --git-diff-code-line-height: {GIT_DIFF_CODE_LINE_HEIGHT_RATIO:g};
    }}
    html[data-mobile="1"] .composer {{
      width: min(var(--composer-overlay-max-width, var(--message-max-width)), calc(100vw - 24px));
      max-width: var(--composer-overlay-max-width, var(--message-max-width));
    }}
    html[data-mobile="1"] .composer-main-shell {{
      max-width: var(--composer-overlay-max-width, var(--message-max-width));
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
    .message:not(.user):not(.system) .md-body {{
      font-family: var(--font-main);
      color: var(--fg);
    }}
    {agent_detail_selectors()} {{
      font-family: var(--font-main);
      color: var(--fg);
    }}
    {body_typography_css()}
    """
