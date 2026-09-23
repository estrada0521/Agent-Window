from __future__ import annotations

import json
from pathlib import Path


class CompleteJsonlScan:

    def __init__(self, path: str | Path, start: int = 0) -> None:
        self.path = str(path)
        self.start = start
        self.consumed = start
        self.skipped = 0
        self.last_skip_offset: int | None = None
        self.last_skip_reason: str = ""

    def __iter__(self):
        with open(self.path, "rb") as handle:
            if self.start > 0:
                handle.seek(max(self.start - 1, 0))
                prev = handle.read(1)
                if prev != b"\n":
                    handle.readline()
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
                    self._record_skip(line_start, "not valid utf-8")
                    continue
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    self._record_skip(line_start, "not valid json")
                    continue
                if not isinstance(entry, dict):
                    self._record_skip(line_start, "not a json object")
                    continue
                yield line_start, entry

    def _record_skip(self, offset: int, reason: str) -> None:
        self.skipped += 1
        self.last_skip_offset = offset
        self.last_skip_reason = reason


def report_skipped_lines(runtime, agent: str, scan: CompleteJsonlScan) -> None:
    if not scan.skipped:
        return
    runtime.report_failure(
        f"native log lines skipped: {agent}: {scan.skipped} unparsable line(s), "
        f"latest at offset {scan.last_skip_offset} ({scan.last_skip_reason})"
    )
