from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from message_delivery import mark_agent_sent
from native_log_sync.agents.grok.read_updates import _turn_completed, extract_grok_assistant_text, sync_grok_native_log


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


class _DeliveryRuntime:
    def __init__(self) -> None:
        self.running_agents: list[str] = []

    def _mark_running(self, agent: str) -> None:
        self.running_agents.append(agent)


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

    def test_only_end_turn_completion_marks_a_turn_finished(self) -> None:
        self.assertTrue(
            _turn_completed(
                {"params": {"update": {"sessionUpdate": "turn_completed", "stop_reason": "end_turn"}}}
            )
        )
        self.assertFalse(
            _turn_completed(
                {"params": {"update": {"sessionUpdate": "turn_completed", "stop_reason": "max_tokens"}}}
            )
        )
        self.assertFalse(_turn_completed({"params": {"update": {"sessionUpdate": "agent_message_chunk"}}}))

    def test_sending_to_grok_marks_the_agent_running(self) -> None:
        runtime = _DeliveryRuntime()
        mark_agent_sent(runtime, "grok")
        self.assertEqual(runtime.running_agents, ["grok"])

    def test_initial_latest_reply_then_turn_completed_are_synced(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history = root / "chat_history.jsonl"
            updates = root / "updates.jsonl"
            initial = [
                {"type": "user", "content": [{"type": "text", "text": "hello"}]},
                {"type": "assistant", "content": "Earlier reply"},
                {"type": "assistant", "content": "", "tool_calls": [{"name": "read_file"}]},
                {"type": "assistant", "content": "Current reply"},
            ]
            history.write_text("".join(json.dumps(item) + "\n" for item in initial), encoding="utf-8")
            updates.write_text("", encoding="utf-8")
            runtime = _Runtime(root)

            sync_grok_native_log(runtime, "grok", str(updates))
            first = [json.loads(line)["message"] for line in runtime.index_path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(first, ["Current reply"])
            self.assertEqual(runtime.idle_agents, [])

            with history.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"type": "user", "content": "next"}) + "\n")
                handle.write(json.dumps({"type": "assistant", "content": "Next reply"}) + "\n")
            with updates.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"params": {"update": {"sessionUpdate": "agent_message_chunk"}}}) + "\n")
            sync_grok_native_log(runtime, "grok", str(updates))
            self.assertEqual(runtime.idle_agents, [])

            with updates.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"params": {"update": {"sessionUpdate": "turn_completed", "stop_reason": "end_turn"}}}) + "\n")
            sync_grok_native_log(runtime, "grok", str(updates))

            messages = [json.loads(line)["message"] for line in runtime.index_path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(messages, ["Current reply", "Next reply"])
            self.assertEqual(runtime.idle_agents, ["grok"])


if __name__ == "__main__":
    unittest.main()
