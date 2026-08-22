from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from native_log_sync.agents.codex.read_runtime import iter_tool_calls, runtime_tool_events
from native_log_sync.agents.codex.read_updates import sync_codex_native_log


def _entry(payload: dict) -> dict:
    return {"type": "response_item", "payload": payload}


class _CodexSyncRuntime:
    def __init__(self, root: Path) -> None:
        self._native_log_progress = {}
        self._native_log_current_paths = {}
        self._native_log_projection_status = {}
        self.log_path = root / "agent-index.jsonl"
        self.session_name = "test-session"
        self.workspace = str(root)
        self.idle_agents: list[str] = []
        self.running_marks: list[str] = []
        self._running: set[str] = set()

    def save_sync_state(self) -> None:
        pass

    def _mark_idle(self, agent: str) -> None:
        self.idle_agents.append(agent)
        self._running.discard(agent)

    def _mark_running_from_native_activity(self, agent: str) -> None:
        self.running_marks.append(agent)
        self._running.add(agent)

    def running_agents(self) -> set[str]:
        return set(self._running)


class CodexRuntime56Tests(unittest.TestCase):
    def test_last_runtime_state_event_controls_native_running_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            log_path = root / "rollout.jsonl"
            log_path.write_text("", encoding="utf-8")
            runtime = _CodexSyncRuntime(root)

            sync_codex_native_log(runtime, "codex", str(log_path))
            with log_path.open("a", encoding="utf-8") as handle:
                for kind in ("task_complete", "thread_settings_applied", "task_started"):
                    handle.write(json.dumps({"type": "event_msg", "payload": {"type": kind}}) + "\n")
            sync_codex_native_log(runtime, "codex", str(log_path))
            self.assertEqual(runtime.running_marks, ["codex"])
            self.assertEqual(runtime.idle_agents, [])

            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"type": "event_msg", "payload": {"type": "task_started"}}) + "\n")
            sync_codex_native_log(runtime, "codex", str(log_path))
            self.assertEqual(runtime.running_marks, ["codex"])

            with log_path.open("a", encoding="utf-8") as handle:
                for kind in ("task_started", "task_complete"):
                    handle.write(json.dumps({"type": "event_msg", "payload": {"type": kind}}) + "\n")
            sync_codex_native_log(runtime, "codex", str(log_path))
            self.assertEqual(runtime.idle_agents, ["codex"])

    def test_turn_aborted_keeps_interrupted_codex_idle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            log_path = root / "rollout.jsonl"
            log_path.write_text("", encoding="utf-8")
            runtime = _CodexSyncRuntime(root)

            sync_codex_native_log(runtime, "codex", str(log_path))
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"type": "event_msg", "payload": {"type": "task_started"}}) + "\n")
            sync_codex_native_log(runtime, "codex", str(log_path))
            self.assertEqual(runtime.running_agents(), {"codex"})

            # /interrupt marks the agent idle immediately. Codex then writes a
            # developer interruption notice followed by the terminal event.
            runtime._mark_idle("codex")
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(
                    json.dumps(
                        {
                            "type": "response_item",
                            "payload": {"type": "message", "role": "developer"},
                        }
                    )
                    + "\n"
                )
                handle.write(json.dumps({"type": "event_msg", "payload": {"type": "turn_aborted"}}) + "\n")
            sync_codex_native_log(runtime, "codex", str(log_path))

            self.assertEqual(runtime.running_agents(), set())
            self.assertEqual(runtime.idle_agents, ["codex", "codex"])

    def test_exec_without_nested_tool_is_not_displayed(self) -> None:
        script = 'const matches = ALL_TOOLS.filter(x => x.name === "exec_command"); text(matches);'
        self.assertEqual(
            iter_tool_calls(_entry({"type": "custom_tool_call", "name": "exec", "input": script})),
            [],
        )

    def test_56_special_payload_types_are_visible(self) -> None:
        web = iter_tool_calls(
            _entry({"type": "web_search_call", "action": {"type": "search", "query": "Codex 5.6"}})
        )
        search = iter_tool_calls(
            _entry({"type": "tool_search_call", "arguments": {"query": "spawn agent"}})
        )
        self.assertEqual(web, [("web_search", {"type": "search", "query": "Codex 5.6"})])
        self.assertEqual(search, [("tool_search", {"query": "spawn agent"})])
        self.assertTrue(runtime_tool_events(*web[0])[0]["text"])
        self.assertTrue(runtime_tool_events(*search[0])[0]["text"])

    def test_unknown_56_tool_uses_generic_fallback(self) -> None:
        events = runtime_tool_events("future_connector", {"value": 1})
        self.assertTrue(events[0]["text"])

    def test_polling_transport_calls_remain_quiet(self) -> None:
        self.assertEqual(runtime_tool_events("wait", {"cell_id": "1"}), [])
        self.assertEqual(runtime_tool_events("write_stdin", {"session_id": 1}), [])


if __name__ == "__main__":
    unittest.main()
