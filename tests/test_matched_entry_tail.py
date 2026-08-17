from __future__ import annotations

import json
import tempfile
import threading
import unittest
from collections import deque
from pathlib import Path

from server.index_cache import (
    MATCHED_ENTRY_TAIL,
    find_matched_entry,
    message_entry_window,
)


class _IndexRuntime:
    def __init__(self, log_path: Path) -> None:
        self.log_path = log_path
        self._matched_entries_cache_lock = threading.Lock()
        self._matched_entries_cache_sig = (0, 0)
        self._matched_entries_cache_size = 0
        self._matched_entries_cache_entries = deque(maxlen=MATCHED_ENTRY_TAIL)
        self._matched_entries_total = 0


def _write_log(path: Path, count: int) -> None:
    lines = [
        json.dumps({"msg_id": f"m{i}", "sender": "user", "message": f"hello {i}"}, ensure_ascii=True)
        for i in range(count)
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


class MatchedEntryTailTests(unittest.TestCase):
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
            self.assertEqual(entries[0]["msg_id"], "m150")
            self.assertEqual(entries[-1]["msg_id"], "m199")
            self.assertLessEqual(len(runtime._matched_entries_cache_entries), MATCHED_ENTRY_TAIL)

    def test_older_window_and_lookup_read_past_the_tail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "log.jsonl"
            _write_log(log_path, 200)
            runtime = _IndexRuntime(log_path)
            message_entry_window(runtime, limit_override=50, default_limit=2000)
            older, has_older, total = message_entry_window(
                runtime,
                limit_override=50,
                default_limit=2000,
                before_msg_id="m150",
            )
            self.assertEqual(total, 200)
            self.assertTrue(has_older)
            self.assertEqual(older[0]["msg_id"], "m100")
            self.assertEqual(older[-1]["msg_id"], "m149")
            found = find_matched_entry(runtime, "m3")
            self.assertIsNotNone(found)
            self.assertEqual(found["message"], "hello 3")

    def test_append_keeps_new_tail_without_growing_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "log.jsonl"
            _write_log(log_path, 80)
            runtime = _IndexRuntime(log_path)
            message_entry_window(runtime, limit_override=50, default_limit=2000)
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"msg_id": "m80", "sender": "user", "message": "hello 80"}) + "\n")
            entries, has_older, total = message_entry_window(
                runtime,
                limit_override=50,
                default_limit=2000,
            )
            self.assertEqual(total, 81)
            self.assertTrue(has_older)
            self.assertEqual(entries[-1]["msg_id"], "m80")
            self.assertLessEqual(len(runtime._matched_entries_cache_entries), MATCHED_ENTRY_TAIL)
