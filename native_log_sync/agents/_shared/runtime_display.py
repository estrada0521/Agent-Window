from __future__ import annotations


def short_line(value: object, limit: int = 120) -> str:
    line = str(value or "").split("\n", 1)[0].strip()
    return line[: limit - 3] + "..." if len(line) > limit else line


def unknown_tool_label(raw_name: object) -> tuple[str, str]:
    return "Tool", str(raw_name or "").strip()


def runtime_event(main: str, sub: str = "", *, source_id: str) -> dict:
    m = str(main or "").strip()
    s = str(sub or "").strip()
    return {"keyword": m, "detail": s, "source_id": source_id}
