from __future__ import annotations

import json
import tempfile
import threading
import unittest
from collections import deque
from pathlib import Path

from server.index_cache import (
    LOG_TAIL_SIZE,
    message_entry_window,
)


class _IndexRuntime:
    def __init__(self, log_path: Path) -> None:
        self.log_path = log_path
        self._log_tail_lock = threading.Lock()
        self._log_tail_sig = (0, 0)
        self._log_tail_size = 0
        self._log_tail_entries = deque(maxlen=LOG_TAIL_SIZE)
        self._log_entry_total = 0


def _write_log(path: Path, count: int) -> None:
    lines = [
        json.dumps({"context_hash": f"m{i}", "sender": "user", "message": f"hello {i}"}, ensure_ascii=True)
        for i in range(count)
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


class LogTailTests(unittest.TestCase):
    def test_tail_cache_stays_bounded_and_serves_latest_window(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "log.jsonl"
            _write_log(log_path, 200)
            runtime = _IndexRuntime(log_path)
            entries, has_older, total = message_entry_window(
                runtime,
                limit_override=50,
                default_limit=2000,
            )
            self.assertEqual(total, 200)
            self.assertTrue(has_older)
            self.assertEqual(len(entries), 50)
            self.assertEqual(entries[0]["context_hash"], "m150")
            self.assertEqual(entries[-1]["context_hash"], "m199")
            self.assertLessEqual(len(runtime._log_tail_entries), LOG_TAIL_SIZE)

    def test_older_window_reads_past_the_tail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "log.jsonl"
            _write_log(log_path, 200)
            runtime = _IndexRuntime(log_path)
            message_entry_window(runtime, limit_override=50, default_limit=2000)
            older, has_older, total = message_entry_window(
                runtime,
                limit_override=50,
                default_limit=2000,
                offset=50,
            )
            self.assertEqual(total, 200)
            self.assertTrue(has_older)
            self.assertEqual(older[0]["context_hash"], "m100")
            self.assertEqual(older[-1]["context_hash"], "m149")

    def test_append_keeps_new_tail_without_growing_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "log.jsonl"
            _write_log(log_path, 80)
            runtime = _IndexRuntime(log_path)
            message_entry_window(runtime, limit_override=50, default_limit=2000)
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"context_hash": "m80", "sender": "user", "message": "hello 80"}) + "\n")
            entries, has_older, total = message_entry_window(
                runtime,
                limit_override=50,
                default_limit=2000,
            )
            self.assertEqual(total, 81)
            self.assertTrue(has_older)
            self.assertEqual(entries[-1]["context_hash"], "m80")
            self.assertLessEqual(len(runtime._log_tail_entries), LOG_TAIL_SIZE)
