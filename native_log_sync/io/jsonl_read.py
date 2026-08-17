from __future__ import annotations

import json
from pathlib import Path


class CompleteJsonlScan:
    """Iterate complete JSON objects in a jsonl file.

    An incomplete trailing line is left unread (`consumed` stays before it).
    A complete line that is not a UTF-8 JSON object is skipped: the cursor
    advances, and nothing is yielded. The CLI owns those records.
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
                self.consumed = handle.tell()
                try:
                    line = raw.decode("utf-8").strip()
                except UnicodeDecodeError:
                    continue
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(entry, dict):
                    continue
                yield line_start, entry


def complete_jsonl_scan(
    path: str | Path,
    start: int = 0,
    *,
    align_mid_line: bool = False,
) -> CompleteJsonlScan:
    return CompleteJsonlScan(path, start, align_mid_line=align_mid_line)
