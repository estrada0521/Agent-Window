from __future__ import annotations


def short_line(value: object, limit: int = 120) -> str:
    line = str(value or "").split("\n", 1)[0].strip()
    return line[: limit - 3] + "..." if len(line) > limit else line


def runtime_event(main: str, sub: str = "", *, source_id: str) -> dict:
    m = str(main or "").strip()
    s = str(sub or "").strip()
    if m and s:
        text = f"{m} {s}"
    elif m:
        text = m
    elif s:
        text = s
    else:
        text = ""
    return {"text": text, "source_id": source_id}
