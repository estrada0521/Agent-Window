from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from native_log_sync.agents.cursor.read_updates import sync_cursor_native_log


def _assistant(text: str) -> dict:
    return {"role": "assistant", "message": {"content": [{"type": "text", "text": text}]}}


class _Runtime:
    def __init__(self, root: Path) -> None:
        self._native_log_read_offsets = {}
        self._native_log_projection_status = {}
        self.log_path = root / "agent-index.jsonl"
        self.session_name = "test-session"
        self.workspace = str(root)
        self.idle_agents: list[str] = []

    def _mark_idle(self, agent: str) -> None:
        self.idle_agents.append(agent)


class CursorNativeLogTests(unittest.TestCase):
    def test_mid_line_offset_skips_to_next_row(self) -> None:
        # Starting observation at the current file end can land inside a line
        # that the provider has not finished writing yet. Its remainder is not
        # a new JSONL record and must be skipped.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            transcript = root / "transcript.jsonl"
            first = json.dumps(_assistant("見えます。コミットしました"), ensure_ascii=False) + "\n"
            second = json.dumps(_assistant("pong"), ensure_ascii=False) + "\n"
            transcript.write_text(first + second, encoding="utf-8")
            runtime = _Runtime(root)
            mid = len(first.encode("utf-8")) // 2
            runtime._native_log_read_offsets[str(transcript.resolve())] = mid

            sync_cursor_native_log(runtime, "cursor", str(transcript))
            messages = [
                json.loads(line)["message"]
                for line in runtime.log_path.read_text(encoding="utf-8").splitlines()
                if line
            ]
            self.assertEqual(messages, ["pong"])
