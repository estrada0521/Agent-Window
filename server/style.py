from __future__ import annotations


def _agent_markdown_selectors(*suffixes: str, prefix: str = "") -> str:
    parts = []
    suffix_list = suffixes or ("",)
    base = f"    {prefix}.message:not(.user):not(.system) .md-body"
    for suffix in suffix_list:
        parts.append(f"{base}{suffix}")
    return ",\n".join(parts)


BOLD_MODE_VIEWPORT_MAX_PX = 480


def _bh_agent_detail_selectors(prefix: str = "") -> str:
    return _agent_markdown_selectors(
        " p",
        " li",
        " h1",
        " h2",
        " h3",
        " h4",
        " blockquote",
        prefix=prefix,
    )
