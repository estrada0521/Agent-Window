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
        self._native_log_progress = {}
        self._native_log_current_paths = {}
        self._native_log_projection_status = {}
        self.log_path = root / "agent-index.jsonl"
        self.session_name = "test-session"
        self.workspace = str(root)
        self.saved = 0
        self.idle_agents: list[str] = []

    def save_sync_state(self) -> None:
        self.saved += 1

    def _mark_idle(self, agent: str) -> None:
        self.idle_agents.append(agent)


class CursorNativeLogTests(unittest.TestCase):
    def test_mid_line_offset_skips_to_next_row(self) -> None:
        # `align_mid_line` in complete_jsonl_scan is shared code, but Cursor is
        # the only caller that passes it. When stored progress is missing,
        # sync_cursor_native_log recovers the resume offset by locating the
        # last already-projected message inside the raw transcript, and that
        # recovery can legitimately land mid-line. The other agents always
        # resume from their own stored byte offset, which is already
        # line-aligned by construction, so they never need this. Do not
        # "simplify" this away as duplicate provider logic.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            transcript = root / "transcript.jsonl"
            first = json.dumps(_assistant("見えます。コミットしました"), ensure_ascii=False) + "\n"
            second = json.dumps(_assistant("pong"), ensure_ascii=False) + "\n"
            transcript.write_text(first + second, encoding="utf-8")
            runtime = _Runtime(root)
            mid = len(first.encode("utf-8")) // 2
            runtime._native_log_progress[str(transcript.resolve())] = mid

            sync_cursor_native_log(runtime, "cursor", str(transcript))
            messages = [
                json.loads(line)["message"]
                for line in runtime.log_path.read_text(encoding="utf-8").splitlines()
                if line
            ]
            self.assertEqual(messages, ["pong"])
