from __future__ import annotations


def font_family_stack(selection: str, role: str) -> str:
    value = str(selection or "").strip()
    cjk_sans_fallback = '"Hiragino Sans", "Yu Gothic", Meiryo, "Noto Sans CJK JP", "PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR"'
    sans_stack = f'"anthropicSans", "Anthropic Sans", "SF Pro Text", "Segoe UI", {cjk_sans_fallback}, sans-serif'
    serif_stack = f'"anthropicSerif", "Anthropic Serif", Georgia, "Arial Hebrew", "Noto Sans Hebrew", "Times New Roman", Times, {cjk_sans_fallback}, serif'
    default_stack = sans_stack if role == "user" else serif_stack
    if value == "preset-gothic":
        return sans_stack
    if value == "preset-mincho":
        return serif_stack
    if value.startswith("system:"):
        family = value.split(":", 1)[1].strip()
        if family:
            return f'"{family}", {default_stack}'
    return default_stack


def chat_font_settings_inline_style(
    settings: dict,
    *,
    bold_mode_viewport_max_px: int,
    generate_agent_message_selectors_fn,
    chat_bold_mode_rules_block_fn,
    bh_agent_detail_selectors_fn,
    font_family_stack_fn=font_family_stack,
) -> str:
    user_family = font_family_stack_fn(settings.get("user_message_font", "preset-gothic"), "user")
    agent_family = font_family_stack_fn(settings.get("agent_message_font", "preset-mincho"), "agent")
    sans_family = font_family_stack_fn("preset-gothic", "user")
    try:
        _legacy_size = max(8, min(18, int(settings.get("message_text_size", 13))))
    except Exception:
        _legacy_size = 13
    try:
        message_text_size_desktop = max(8, min(18, int(settings.get("message_text_size_desktop") or _legacy_size)))
    except Exception:
        message_text_size_desktop = _legacy_size
    try:
        message_text_size_mobile = max(8, min(18, int(settings.get("message_text_size_mobile") or _legacy_size)))
    except Exception:
        message_text_size_mobile = _legacy_size
    message_max_width = 900

    bold_parts: list[str] = []
    non_tauri_desktop_scope = 'html:not([data-tauri-app="1"][data-hub-iframe-chat="1"])'
    if settings.get("bold_mode_mobile"):
        mobile_inner = chat_bold_mode_rules_block_fn(non_tauri_desktop_scope)
        bold_parts.append(
            f"@media (max-width: {bold_mode_viewport_max_px}px) {{\n{mobile_inner}\n    }}"
        )
    bold_style = "\n".join(bold_parts)
    mobile_text_size_override = ""
    if message_text_size_mobile != message_text_size_desktop:
        non_tauri = 'html:not([data-tauri-app="1"][data-hub-iframe-chat="1"])'
        mobile_text_size_override = f"""
    @media (max-width: {bold_mode_viewport_max_px}px) {{
      {non_tauri} {{
        --message-text-size: {message_text_size_mobile}px;
        --message-text-line-height: {message_text_size_mobile + 9}px;
      }}
    }}"""
    typography_override = """
    .message.user .md-body,
    .message.user .md-body p,
    .message.user .md-body li,
    .message.user .md-body li p {
      font-family: var(--user-message-font-family);
      font-weight: 430;
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
      font-weight: 430;
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
      --user-message-font-family: {user_family};
      --agent-message-font-family: {agent_family};
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
    {generate_agent_message_selectors_fn(" .md-body")} {{
      font-family: var(--agent-message-font-family);
      color: var(--fg);
    }}
    {bh_agent_detail_selectors_fn(prefix="")} {{
      font-family: var(--agent-message-font-family);
      color: var(--fg);
    }}
    {typography_override}
    {bold_style}
    {mobile_text_size_override}
    """
