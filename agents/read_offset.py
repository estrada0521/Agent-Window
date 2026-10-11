from __future__ import annotations


def read_offset_start(offsets: dict[str, int], path: str, file_size: int, *, wait_on_shrink: bool = False) -> int:
    start = offsets.get(path, 0)
    if file_size < start and not wait_on_shrink:
        raise RuntimeError(f"native log shrank: {path} size={file_size} progress={start}")
    return start
