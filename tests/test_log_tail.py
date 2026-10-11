from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from fs.log.jsonl import message_window


def _write_log(path: Path, count: int) -> None:
    lines = [
        json.dumps({"context_hash": f"m{i}", "sender": "user", "message": f"hello {i}"}, ensure_ascii=True)
        for i in range(count)
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


class LogTailTests(unittest.TestCase):
    def test_latest_window_is_in_log_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "log.jsonl"
            _write_log(log_path, 200)
            entries = message_window(log_path, cursor=log_path.stat().st_size, limit=51, before=True)["entries"]
            self.assertEqual(len(entries), 51)
            self.assertEqual(entries[0]["context_hash"], "m149")
            self.assertEqual(entries[-1]["context_hash"], "m199")


if __name__ == "__main__":
    unittest.main()
