from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from native_log_sync.agents.grok.read_updates import extract_grok_assistant_text, sync_grok_native_log


class _Runtime:
    def __init__(self, root: Path) -> None:
        self._grok_cursors = {}
        self._synced_msg_ids = set()
        self._synced_message_fingerprints = set()
        self.index_path = root / "agent-index.jsonl"
        self.session_name = "test-session"
        self.saved = 0
        self.idle_agents: list[str] = []

    def save_sync_state(self) -> None:
        self.saved += 1

    def _mark_idle(self, agent: str) -> None:
        self.idle_agents.append(agent)


class GrokNativeLogTests(unittest.TestCase):
    def test_final_assistant_text_is_extracted(self) -> None:
        self.assertEqual(
            extract_grok_assistant_text({"type": "assistant", "content": "Ready."}),
            "Ready.",
        )

    def test_thoughts_tools_and_user_entries_are_ignored(self) -> None:
        cases = [
            {"type": "assistant", "content": "", "tool_calls": [{"name": "read_file"}]},
            {"type": "user", "content": [{"type": "text", "text": "hello"}]},
            {"type": "tool_result", "content": "done"},
            {"type": "assistant", "content": [{"type": "text", "text": "not final"}]},
        ]
        for entry in cases:
            with self.subTest(entry=entry):
                self.assertEqual(extract_grok_assistant_text(entry), "")

    def test_initial_latest_reply_then_following_appends_are_synced(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history = root / "chat_history.jsonl"
            initial = [
                {"type": "user", "content": [{"type": "text", "text": "hello"}]},
                {"type": "assistant", "content": "Earlier reply"},
                {"type": "assistant", "content": "", "tool_calls": [{"name": "read_file"}]},
                {"type": "assistant", "content": "Current reply"},
            ]
            history.write_text("".join(json.dumps(item) + "\n" for item in initial), encoding="utf-8")
            runtime = _Runtime(root)

            sync_grok_native_log(runtime, "grok", str(history))
            first = [json.loads(line)["message"] for line in runtime.index_path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(first, ["Current reply"])

            with history.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"type": "user", "content": "next"}) + "\n")
                handle.write(json.dumps({"type": "assistant", "content": "Next reply"}) + "\n")
            sync_grok_native_log(runtime, "grok", str(history))

            messages = [json.loads(line)["message"] for line in runtime.index_path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(messages, ["Current reply", "Next reply"])
            self.assertEqual(runtime.idle_agents, ["grok", "grok"])


if __name__ == "__main__":
    unittest.main()
