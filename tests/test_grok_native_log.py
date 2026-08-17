from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from message_delivery import mark_agent_sent
from native_log_sync.agents.grok.read_runtime import (
    iter_tool_calls_from_update,
    runtime_tool_events,
)
from native_log_sync.agents.grok.read_updates import _turn_completed, extract_grok_assistant_text, sync_grok_native_log


class _Runtime:
    def __init__(self, root: Path) -> None:
        self._native_log_progress = {}
        self._native_log_current_paths = {}
        self.log_path = root / "agent-index.jsonl"
        self.session_name = "test-session"
        self.workspace = str(root)
        self.saved = 0
        self.idle_agents: list[str] = []
        self._idle_running_event_seq = 0
        self._idle_running_display_by_agent: dict = {}
        self.runtime_notifies: list[str] = []

    def save_sync_state(self) -> None:
        self.saved += 1

    def _mark_idle(self, agent: str) -> None:
        self.idle_agents.append(agent)

    def notify_session_state_changed(self, keys, *, reason: str = "") -> None:
        self.runtime_notifies.append(reason)


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

    def test_assistant_text_alongside_tool_calls_is_still_extracted(self) -> None:
        self.assertEqual(
            extract_grok_assistant_text(
                {
                    "type": "assistant",
                    "content": "Checking the file first.",
                    "tool_calls": [{"name": "read_file"}],
                }
            ),
            "Checking the file first.",
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

    def test_tool_call_start_is_parsed_and_updates_are_ignored(self) -> None:
        start = {
            "params": {
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": "call-1",
                    "title": "read_file",
                    "rawInput": {"target_file": "/repo/README.md"},
                    "_meta": {"x.ai/tool": {"name": "read_file", "kind": "read"}},
                }
            }
        }
        update = {
            "params": {
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "call-1",
                    "status": "completed",
                    "title": "README.md",
                }
            }
        }
        self.assertEqual(
            iter_tool_calls_from_update(start),
            [("read_file", {"target_file": "/repo/README.md", "_tool_call_id": "call-1"})],
        )
        self.assertEqual(iter_tool_calls_from_update(update), [])

    def test_runtime_labels_match_common_grok_tools(self) -> None:
        cases = [
            (
                "run_terminal_command",
                {"command": "ls -la", "description": "List root"},
                "Bash List root",
            ),
            (
                "read_file",
                {"target_file": "/Users/okadaharuto/workspace/Agent-Window/README.md"},
                "Read README.md",
            ),
            (
                "grep",
                {"pattern": "typing", "glob": "*.py"},
                "Search typing in *.py",
            ),
            (
                "list_dir",
                {"target_directory": "/Users/okadaharuto/workspace/Agent-Window/apps"},
                "Explore apps",
            ),
            (
                "web_search",
                {"query": "grok build cli"},
                "Search grok build cli",
            ),
        ]
        ws = "/Users/okadaharuto/workspace/Agent-Window"
        for name, args, expected in cases:
            with self.subTest(name=name):
                events = runtime_tool_events(name, args, workspace=ws)
                self.assertEqual(len(events), 1)
                self.assertEqual(events[0]["text"], expected)

    def test_tool_call_events_push_running_display(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history = root / "chat_history.jsonl"
            updates = root / "updates.jsonl"
            history.write_text(
                json.dumps({"type": "assistant", "content": "hi"}) + "\n",
                encoding="utf-8",
            )
            updates.write_text("", encoding="utf-8")
            runtime = _Runtime(root)
            sync_grok_native_log(runtime, "grok", str(updates))

            tool_row = {
                "params": {
                    "update": {
                        "sessionUpdate": "tool_call",
                        "toolCallId": "call-abc",
                        "title": "grep",
                        "rawInput": {"pattern": "native_log", "path": str(root / "x.py")},
                        "_meta": {"x.ai/tool": {"name": "grep"}},
                    }
                }
            }
            noise = {
                "params": {
                    "update": {
                        "sessionUpdate": "tool_call_update",
                        "toolCallId": "call-abc",
                        "status": "completed",
                        "title": "very long execute title that should not display",
                    }
                }
            }
            with updates.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(tool_row) + "\n")
                handle.write(json.dumps(noise) + "\n")
            sync_grok_native_log(runtime, "grok", str(updates))

            payload = runtime._idle_running_display_by_agent.get("grok") or {}
            event = payload.get("current_event") or {}
            self.assertIn("Search", str(event.get("text") or ""))
            self.assertIn("native_log", str(event.get("text") or ""))
            self.assertTrue(runtime.runtime_notifies)

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
            first = [json.loads(line)["message"] for line in runtime.log_path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(first, ["Current reply"])
            self.assertEqual(runtime.idle_agents, [])

            with history.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"type": "user", "content": "next"}) + "\n")
                handle.write(json.dumps({"type": "assistant", "content": "Next reply"}) + "\n")
            with updates.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"params": {"update": {"sessionUpdate": "agent_message_chunk"}}}) + "\n")
            sync_grok_native_log(runtime, "grok", str(updates))
            self.assertEqual(runtime.idle_agents, [])
            # Replies land as soon as they appear in chat_history.jsonl, not
            # only once the turn_completed event arrives.
            mid_turn = [json.loads(line)["message"] for line in runtime.log_path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(mid_turn, ["Current reply", "Next reply"])

            with updates.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"params": {"update": {"sessionUpdate": "turn_completed", "stop_reason": "end_turn"}}}) + "\n")
            sync_grok_native_log(runtime, "grok", str(updates))

            messages = [json.loads(line)["message"] for line in runtime.log_path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(messages, ["Current reply", "Next reply"])
            self.assertEqual(runtime.idle_agents, ["grok"])


if __name__ == "__main__":
    unittest.main()
