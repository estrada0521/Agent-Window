from __future__ import annotations

from collections.abc import Mapping


# ---------------------------------------------------------------------------
# Text-color roles.
#
# Every role below is one fact per (client, theme) -- desktop/mobile x
# light/dark -- named once and read from here everywhere it's needed. A role
# is never redefined under a second name, and a client/theme that doesn't
# use a role simply doesn't reference its constant; there is no "default
# plus override" tier. Where a role's value is identical across desktop and
# mobile (or across light/dark), it gets one constant, not two copies of the
# same channels string.
#
# Icon colors (icon-fg/icon-muted/icon-hover/chip-color) and the code-pane
# line-number gray are a separate, still-scattered system and out of scope
# here; see resolve_theme_palette() below.
# ---------------------------------------------------------------------------

TEXT_PRIMARY_DESKTOP_LIGHT_CHANNELS = "11, 11, 11"
TEXT_PRIMARY_DESKTOP_DARK_CHANNELS = "200, 200, 200"
TEXT_PRIMARY_MOBILE_LIGHT_CHANNELS = "31, 31, 31"
TEXT_PRIMARY_MOBILE_DARK_CHANNELS = "229, 229, 229"

# Bold/strong emphasis. Desktop has no entry: markdown-body.css falls back
# to text-primary via `var(--fg-bold, var(--fg))` when --fg-bold is
# undefined, so desktop's base CSS simply never defines it. Mobile light
# sits halfway between pure black and text-primary (34) -- heavier than
# body text without the starker pure extreme. Mobile dark matches
# text-primary exactly -- pure white read as too stark against it.
TEXT_STRONG_MOBILE_LIGHT_CHANNELS = "17, 17, 17"
TEXT_STRONG_MOBILE_DARK_CHANNELS = TEXT_PRIMARY_MOBILE_DARK_CHANNELS

TEXT_MUTED_LIGHT_CHANNELS = "120, 120, 120"
TEXT_MUTED_DARK_CHANNELS = "150, 150, 150"

TEXT_LINK_LIGHT_CHANNELS = "36, 85, 161"
TEXT_LINK_DARK_CHANNELS = "144, 157, 174"

TEXT_EXTERNAL_LINK_LIGHT_CHANNELS = "196, 42, 30"
TEXT_EXTERNAL_LINK_DARK_CHANNELS = "224, 88, 88"
# Error text (e.g. a failed panel load) currently reads the same as
# text-external-link in both themes. Kept as its own constant: the decision
# to redden an external link and the decision to redden an error message
# are independent, even though they resolve to the same color today.
TEXT_ERROR_LIGHT_CHANNELS = TEXT_EXTERNAL_LINK_LIGHT_CHANNELS
TEXT_ERROR_DARK_CHANNELS = TEXT_EXTERNAL_LINK_DARK_CHANNELS

TEXT_DIFF_INSERT_LIGHT_CHANNELS = "26, 127, 55"
TEXT_DIFF_INSERT_DARK_CHANNELS = "74, 222, 128"
TEXT_DIFF_DELETE_LIGHT_CHANNELS = "207, 34, 46"
TEXT_DIFF_DELETE_DARK_CHANNELS = "248, 113, 113"

# Hub-only: the session/window title text ("Agent Window", session names).
# A distinct role from text-primary even where the value happens to match
# today (desktop both themes, mobile dark) -- the hub title and the chat
# body are different decisions that are free to diverge.
TEXT_SESSION_DESKTOP_LIGHT_CHANNELS = "11, 11, 11"
TEXT_SESSION_DESKTOP_DARK_CHANNELS = "200, 200, 200"
TEXT_SESSION_MOBILE_LIGHT_CHANNELS = "19, 19, 19"
TEXT_SESSION_MOBILE_DARK_CHANNELS = "200, 200, 200"


# Icon-hover is icon scope, not text scope -- left as-is, untouched by the
# text-color-role cleanup above.
DESKTOP_LIGHT_ICON_HOVER = "rgb(35, 35, 35)"
DESKTOP_DARK_ICON_HOVER = "rgb(190, 190, 190)"
MOBILE_LIGHT_ICON_HOVER = "rgb(35, 35, 35)"
MOBILE_DARK_ICON_HOVER = "rgb(190, 190, 190)"


# Every TEXT_*_CHANNELS constant defined above is a role; nothing else has
# to re-list their names. Adding a role is declaring one constant, not also
# registering it somewhere.
#
# Only the bare channels are emitted -- CSS already has a way to build a
# full color from channels (`rgb(__X_CHANNELS__)`, or `rgb(var(--x-channels))`
# where a var needs to be shared), so there's nothing for Python to convert;
# emitting a second, pre-wrapped "__X__" token would just be the same fact
# spelled two ways.
def _text_color_token_replacements() -> tuple[tuple[str, str], ...]:
    return tuple(
        (f"__{name}__", value)
        for name, value in globals().items()
        if name.startswith("TEXT_") and name.endswith("_CHANNELS")
    )


def _gray_rgb(level: int) -> tuple[int, int, int]:
    value = max(0, min(255, int(level)))
    return (value, value, value)


def _gray_channels(level: int) -> str:
    value = max(0, min(255, int(level)))
    return f"{value}, {value}, {value}"


def _gray_rgb_string(level: int) -> str:
    value = max(0, min(255, int(level)))
    return f"rgb({value},{value},{value})"


MOBILE_HUB_LIGHT_BG_RGB = (243, 243, 241)
MOBILE_HUB_DARK_BG_RGB = (9, 9, 9)


def resolve_theme_levels(settings: Mapping[str, object] | None = None) -> tuple[int, int]:
    theme = str((settings or {}).get("theme", "dark") or "dark").strip().lower()
    if theme == "light":
        return 255, 0
    return 4, 180


def resolve_theme_palette(settings: Mapping[str, object] | None = None) -> dict[str, object]:
    theme = str((settings or {}).get("theme", "dark") or "dark").strip().lower()
    theme = "light" if theme == "light" else "dark"
    bg_level, fg_level = resolve_theme_levels(settings)
    if theme == "light":
        color_scheme = "light"
        fg_soft_level = 18
        fg_bright_level = 0
        panel_strong_level = 250
        surface_level = 250
        surface_alt_level = 245
        hover_level = 235
        inline_border_level = 202
        muted_level = 120
        icon_fg_level = 0
        icon_muted_level = 120
        icon_hover_level = 35
        chip_color_level = 180
        line = "rgba(0, 0, 0, 0.10)"
        line_strong = "rgba(0, 0, 0, 0.18)"
        table_line = "rgba(0, 0, 0, 0.18)"
        table_header_line = "rgba(0, 0, 0, 0.28)"
        code_copy_hover_bg = "rgba(0, 0, 0, 0.08)"
        fab_hover_bg = "rgba(235, 235, 235, 0.92)"
        session_hover_bg = "rgba(0, 0, 0, 0.04)"
        session_selected_bg = "rgba(0, 0, 0, 0.07)"
        panel_row_bg = "rgba(0, 0, 0, 0.06)"
        panel_row_border = "rgba(0, 0, 0, 0.08)"
        panel_row_hover_bg = "rgba(0, 0, 0, 0.08)"
        panel_row_active_bg = "rgba(0, 0, 0, 0.10)"
    else:
        color_scheme = "dark"
        fg_soft_level = max(0, fg_level - 7)
        fg_bright_level = min(255, fg_level + 3)
        panel_strong_level = 5
        surface_level = 10
        surface_alt_level = 15
        hover_level = 20
        inline_border_level = 54
        icon_fg_level = 180
        icon_muted_level = 128
        icon_hover_level = 190
        muted_level = icon_muted_level
        chip_color_level = 70
        line = f"rgba({fg_level}, {fg_level}, {fg_level}, 0.07)"
        line_strong = f"rgba({fg_level}, {fg_level}, {fg_level}, 0.12)"
        table_line = f"rgba({fg_level}, {fg_level}, {fg_level}, 0.12)"
        table_header_line = f"rgba({fg_level}, {fg_level}, {fg_level}, 0.28)"
        code_copy_hover_bg = f"rgba({fg_level}, {fg_level}, {fg_level}, 0.09)"
        fab_hover_bg = "rgba(40, 40, 40, 0.88)"
        session_hover_bg = f"rgba({fg_level}, {fg_level}, {fg_level}, 0.05)"
        session_selected_bg = f"rgba({fg_level}, {fg_level}, {fg_level}, 0.08)"
        panel_row_bg = f"rgba({fg_level}, {fg_level}, {fg_level}, 0.10)"
        panel_row_border = f"rgba({fg_level}, {fg_level}, {fg_level}, 0.14)"
        panel_row_hover_bg = f"rgba({fg_level}, {fg_level}, {fg_level}, 0.13)"
        panel_row_active_bg = f"rgba({fg_level}, {fg_level}, {fg_level}, 0.16)"
    bg_rgb = (bg_level, bg_level, bg_level)
    fg_rgb = (fg_level, fg_level, fg_level)
    fg_soft_rgb = (fg_soft_level, fg_soft_level, fg_soft_level)
    fg_bright_rgb = (fg_bright_level, fg_bright_level, fg_bright_level)
    icon_fg_rgb = _gray_rgb(icon_fg_level)
    icon_muted_rgb = _gray_rgb(icon_muted_level)
    icon_hover_rgb = _gray_rgb(icon_hover_level)
    return {
        "theme": theme,
        "color_scheme": color_scheme,
        "bg_level": bg_level,
        "fg_level": fg_level,
        "fg_soft_level": fg_soft_level,
        "fg_bright_level": fg_bright_level,
        "dark_bg_rgb": bg_rgb,
        "dark_bg_channels": ", ".join(str(v) for v in bg_rgb),
        "dark_bg": f"rgb({','.join(str(v) for v in bg_rgb)})",
        "mobile_hub_light_bg_channels": ", ".join(str(v) for v in MOBILE_HUB_LIGHT_BG_RGB),
        "mobile_hub_light_bg": f"rgb({','.join(str(v) for v in MOBILE_HUB_LIGHT_BG_RGB)})",
        "mobile_hub_dark_bg_channels": ", ".join(str(v) for v in MOBILE_HUB_DARK_BG_RGB),
        "mobile_hub_dark_bg": f"rgb({','.join(str(v) for v in MOBILE_HUB_DARK_BG_RGB)})",
        "light_fg_rgb": fg_rgb,
        "light_fg_channels": ", ".join(str(v) for v in fg_rgb),
        "light_fg": f"rgb({','.join(str(v) for v in fg_rgb)})",
        "light_fg_soft_rgb": fg_soft_rgb,
        "light_fg_soft_channels": ", ".join(str(v) for v in fg_soft_rgb),
        "light_fg_soft": f"rgb({','.join(str(v) for v in fg_soft_rgb)})",
        "light_fg_bright_rgb": fg_bright_rgb,
        "light_fg_bright_channels": ", ".join(str(v) for v in fg_bright_rgb),
        "light_fg_bright": f"rgb({','.join(str(v) for v in fg_bright_rgb)})",
        "gray_panel_strong_level": panel_strong_level,
        "gray_panel_strong_rgb": _gray_rgb(panel_strong_level),
        "gray_panel_strong_channels": _gray_channels(panel_strong_level),
        "gray_panel_strong": _gray_rgb_string(panel_strong_level),
        "gray_surface_level": surface_level,
        "gray_surface_rgb": _gray_rgb(surface_level),
        "gray_surface_channels": _gray_channels(surface_level),
        "gray_surface": _gray_rgb_string(surface_level),
        "gray_surface_alt_level": surface_alt_level,
        "gray_surface_alt_rgb": _gray_rgb(surface_alt_level),
        "gray_surface_alt_channels": _gray_channels(surface_alt_level),
        "gray_surface_alt": _gray_rgb_string(surface_alt_level),
        "gray_hover_level": hover_level,
        "gray_hover_rgb": _gray_rgb(hover_level),
        "gray_hover_channels": _gray_channels(hover_level),
        "gray_hover": _gray_rgb_string(hover_level),
        "gray_inline_border_level": inline_border_level,
        "gray_inline_border_rgb": _gray_rgb(inline_border_level),
        "gray_inline_border_channels": _gray_channels(inline_border_level),
        "gray_inline_border": _gray_rgb_string(inline_border_level),
        "gray_muted_level": muted_level,
        "gray_muted_rgb": _gray_rgb(muted_level),
        "gray_muted_channels": _gray_channels(muted_level),
        "gray_muted": _gray_rgb_string(muted_level),
        "icon_fg_rgb": icon_fg_rgb,
        "icon_fg_channels": _gray_channels(icon_fg_level),
        "icon_fg": _gray_rgb_string(icon_fg_level),
        "icon_muted_rgb": icon_muted_rgb,
        "icon_muted_channels": _gray_channels(icon_muted_level),
        "icon_muted": _gray_rgb_string(icon_muted_level),
        "icon_hover_rgb": icon_hover_rgb,
        "icon_hover_channels": _gray_channels(icon_hover_level),
        "icon_hover": _gray_rgb_string(icon_hover_level),
        "chip_color": _gray_rgb_string(chip_color_level),
        "line": line,
        "line_strong": line_strong,
        "table_line": table_line,
        "table_header_line": table_header_line,
        "code_copy_hover_bg": code_copy_hover_bg,
        "fab_hover_bg": fab_hover_bg,
        "session_hover_bg": session_hover_bg,
        "session_selected_bg": session_selected_bg,
        "panel_row_bg": panel_row_bg,
        "panel_row_border": panel_row_border,
        "panel_row_hover_bg": panel_row_hover_bg,
        "panel_row_active_bg": panel_row_active_bg,
    }


_DEFAULT_THEME = resolve_theme_palette()
DARK_BG = _DEFAULT_THEME["dark_bg"]
LIGHT_FG_CHANNELS = _DEFAULT_THEME["light_fg_channels"]
LIGHT_FG = _DEFAULT_THEME["light_fg"]


def apply_color_tokens(text: str, settings: Mapping[str, object] | None = None) -> str:
    palette = resolve_theme_palette(settings)
    dark_bg = str(palette["dark_bg"])
    dark_bg_channels = str(palette["dark_bg_channels"])
    mobile_hub_light_bg = str(palette["mobile_hub_light_bg"])
    mobile_hub_light_bg_channels = str(palette["mobile_hub_light_bg_channels"])
    mobile_hub_dark_bg = str(palette["mobile_hub_dark_bg"])
    mobile_hub_dark_bg_channels = str(palette["mobile_hub_dark_bg_channels"])
    light_fg = str(palette["light_fg"])
    light_fg_channels = str(palette["light_fg_channels"])
    light_fg_soft = str(palette["light_fg_soft"])
    light_fg_soft_channels = str(palette["light_fg_soft_channels"])
    light_fg_bright = str(palette["light_fg_bright"])
    light_fg_bright_channels = str(palette["light_fg_bright_channels"])
    gray_panel_strong = str(palette["gray_panel_strong"])
    gray_panel_strong_channels = str(palette["gray_panel_strong_channels"])
    gray_surface = str(palette["gray_surface"])
    gray_surface_channels = str(palette["gray_surface_channels"])
    gray_surface_alt = str(palette["gray_surface_alt"])
    gray_surface_alt_channels = str(palette["gray_surface_alt_channels"])
    gray_hover = str(palette["gray_hover"])
    gray_hover_channels = str(palette["gray_hover_channels"])
    gray_inline_border = str(palette["gray_inline_border"])
    gray_inline_border_channels = str(palette["gray_inline_border_channels"])
    gray_muted = str(palette["gray_muted"])
    gray_muted_channels = str(palette["gray_muted_channels"])
    icon_fg = str(palette["icon_fg"])
    icon_muted = str(palette["icon_muted"])
    icon_hover = str(palette["icon_hover"])
    chip_color = str(palette["chip_color"])

    theme_mobile_setting = str((settings or {}).get("theme_mobile", "system") or "system").strip().lower()
    replacements: tuple[tuple[str, str], ...] = (
        ("__THEME__", str(palette["theme"])),
        ("__THEME_MOBILE_SETTING__", theme_mobile_setting),
        ("__COLOR_SCHEME__", str(palette["color_scheme"])),
        ("__DARK_BG__", dark_bg),
        ("__DARK_BG_CHANNELS__", dark_bg_channels),
        ("__MOBILE_HUB_LIGHT_BG__", mobile_hub_light_bg),
        ("__MOBILE_HUB_LIGHT_BG_CHANNELS__", mobile_hub_light_bg_channels),
        ("__MOBILE_HUB_DARK_BG__", mobile_hub_dark_bg),
        ("__MOBILE_HUB_DARK_BG_CHANNELS__", mobile_hub_dark_bg_channels),
        ("__LIGHT_FG__", light_fg),
        ("__LIGHT_FG_CHANNELS__", light_fg_channels),
        ("__LIGHT_FG_SOFT__", light_fg_soft),
        ("__LIGHT_FG_SOFT_CHANNELS__", light_fg_soft_channels),
        ("__LIGHT_FG_BRIGHT__", light_fg_bright),
        ("__LIGHT_FG_BRIGHT_CHANNELS__", light_fg_bright_channels),
        ("__GRAY_PANEL_STRONG__", gray_panel_strong),
        ("__GRAY_PANEL_STRONG_CHANNELS__", gray_panel_strong_channels),
        ("__GRAY_SURFACE__", gray_surface),
        ("__GRAY_SURFACE_CHANNELS__", gray_surface_channels),
        ("__GRAY_SURFACE_ALT__", gray_surface_alt),
        ("__GRAY_SURFACE_ALT_CHANNELS__", gray_surface_alt_channels),
        ("__GRAY_HOVER__", gray_hover),
        ("__GRAY_HOVER_CHANNELS__", gray_hover_channels),
        ("__GRAY_INLINE_BORDER__", gray_inline_border),
        ("__GRAY_INLINE_BORDER_CHANNELS__", gray_inline_border_channels),
        ("__GRAY_MUTED__", gray_muted),
        ("__GRAY_MUTED_CHANNELS__", gray_muted_channels),
        ("__ICON_FG__", icon_fg),
        ("__ICON_MUTED__", icon_muted),
        ("__ICON_HOVER__", icon_hover),
        ("__CHIP_COLOR__", chip_color),
        ("__DESKTOP_LIGHT_ICON_HOVER__", DESKTOP_LIGHT_ICON_HOVER),
        ("__DESKTOP_DARK_ICON_HOVER__", DESKTOP_DARK_ICON_HOVER),
        ("__MOBILE_LIGHT_ICON_HOVER__", MOBILE_LIGHT_ICON_HOVER),
        ("__MOBILE_DARK_ICON_HOVER__", MOBILE_DARK_ICON_HOVER),
        *_text_color_token_replacements(),
        ("__LINE__", str(palette["line"])),
        ("__LINE_STRONG__", str(palette["line_strong"])),
        ("__TABLE_LINE__", str(palette["table_line"])),
        ("__TABLE_HEADER_LINE__", str(palette["table_header_line"])),
        ("__CODE_COPY_HOVER_BG__", str(palette["code_copy_hover_bg"])),
        ("__FAB_HOVER_BG__", str(palette["fab_hover_bg"])),
        ("__SESSION_HOVER_BG__", str(palette["session_hover_bg"])),
        ("__SESSION_SELECTED_BG__", str(palette["session_selected_bg"])),
        ("__PANEL_ROW_BG__", str(palette["panel_row_bg"])),
        ("__PANEL_ROW_BORDER__", str(palette["panel_row_border"])),
        ("__PANEL_ROW_HOVER_BG__", str(palette["panel_row_hover_bg"])),
        ("__PANEL_ROW_ACTIVE_BG__", str(palette["panel_row_active_bg"])),
    )
    resolved = text
    for old, new in replacements:
        resolved = resolved.replace(old, new)
    return resolved
