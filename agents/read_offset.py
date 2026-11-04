from __future__ import annotations


def read_offset_start(offsets: dict[str, int], path: str, file_size: int, *, wait_on_shrink: bool = False) -> int:
    start = offsets.get(path, 0)
    if file_size < start:
        # An empty file is a rewrite still in progress. Adopting 0 would read the history that follows.
        if wait_on_shrink or file_size == 0:
            return start
        offsets[path] = file_size
        return file_size
    return start
