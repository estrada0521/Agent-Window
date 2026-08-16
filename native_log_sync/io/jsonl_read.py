from __future__ import annotations

import json
from pathlib import Path


class CompleteJsonlScan:
    """Iterate complete JSON objects in a jsonl file.

    An incomplete trailing line is left unread (`consumed` stays before it).
    A complete line that is not UTF-8 JSON object raises.
    """

    def __init__(self, path: str | Path, start: int = 0, *, align_mid_line: bool = False) -> None:
        self.path = str(path)
        self.start = start
        self.align_mid_line = align_mid_line
        self.consumed = start

    def __iter__(self):
        with open(self.path, "rb") as handle:
            if self.start > 0:
                if self.align_mid_line:
                    handle.seek(max(self.start - 1, 0))
                    prev = handle.read(1)
                    if prev != b"\n":
                        handle.readline()
                else:
                    handle.seek(self.start)
            self.consumed = handle.tell()
            while True:
                line_start = handle.tell()
                raw = handle.readline()
                if not raw:
                    break
                if not raw.endswith((b"\n", b"\r")):
                    break
                try:
                    line = raw.decode("utf-8").strip()
                except UnicodeDecodeError as exc:
                    raise RuntimeError(
                        f"corrupt jsonl {self.path} at offset {line_start}"
                    ) from exc
                if not line:
                    self.consumed = handle.tell()
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise RuntimeError(
                        f"corrupt jsonl {self.path} at offset {line_start}"
                    ) from exc
                if not isinstance(entry, dict):
                    raise RuntimeError(
                        f"jsonl {self.path} at offset {line_start} is not an object"
                    )
                self.consumed = handle.tell()
                yield line_start, entry


def complete_jsonl_scan(
    path: str | Path,
    start: int = 0,
    *,
    align_mid_line: bool = False,
) -> CompleteJsonlScan:
    return CompleteJsonlScan(path, start, align_mid_line=align_mid_line)
