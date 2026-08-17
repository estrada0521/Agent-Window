from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from native_log_sync.agents.codex.read_runtime import iter_tool_calls, runtime_tool_events
from native_log_sync.agents.codex.read_updates import _codex_runtime_state_event, sync_codex_native_log


def _entry(payload: dict) -> dict:
    return {"type": "response_item", "payload": payload}


class _CodexSyncRuntime:
    def __init__(self, root: Path) -> None:
        self._native_log_progress = {}
        self._native_log_current_paths = {}
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

    def test_only_semantic_codex_activity_reactivates_running(self) -> None:
        active_entries = [
            {"type": "event_msg", "payload": {"type": "task_started"}},
            {"type": "event_msg", "payload": {"type": "agent_message"}},
            _entry({"type": "message"}),
            _entry({"type": "function_call"}),
            _entry({"type": "custom_tool_call"}),
            _entry({"type": "web_search_call"}),
            _entry({"type": "tool_search_call"}),
        ]
        for entry in active_entries:
            self.assertEqual(_codex_runtime_state_event(entry), "active")

        inactive_entries = [
            {"type": "event_msg", "payload": {"type": "thread_settings_applied"}},
            {"type": "event_msg", "payload": {"type": "token_count"}},
            _entry({"type": "reasoning"}),
            _entry({"type": "function_call_output"}),
            _entry({"type": "custom_tool_call_output"}),
        ]
        for entry in inactive_entries:
            self.assertEqual(_codex_runtime_state_event(entry), "")
        self.assertEqual(
            _codex_runtime_state_event({"type": "event_msg", "payload": {"type": "task_complete"}}),
            "completed",
        )
        self.assertEqual(
            _codex_runtime_state_event({"type": "event_msg", "payload": {"type": "turn_aborted"}}),
            "completed",
        )

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

    def test_exec_unwraps_multiple_calls_without_matching_strings(self) -> None:
        script = '''
const fake = "tools.view_image({\\"path\\":\\"wrong.png\\"})";
const plan = await tools.update_plan({"plan":[{"step":"x","status":"in_progress"}]});
const result = await tools.exec_command({"cmd":"rg 'tools.fake()' src","workdir":"/tmp"});
'''
        calls = iter_tool_calls(
            _entry({"type": "custom_tool_call", "name": "exec", "input": script})
        )
        self.assertEqual([name for name, _ in calls], ["update_plan", "exec_command"])
        self.assertEqual(calls[1][1]["cmd"], "rg 'tools.fake()' src")

    def test_exec_resolves_freeform_tool_variable(self) -> None:
        script = '''
const patch = "*** Begin Patch\\n*** Update File: app.py\\n*** End Patch";
const result = await tools.apply_patch(patch);
'''
        calls = iter_tool_calls(
            _entry({"type": "custom_tool_call", "name": "exec", "input": script})
        )
        self.assertEqual(calls[0][0], "apply_patch")
        self.assertIn("Update File: app.py", calls[0][1])
        self.assertEqual(runtime_tool_events(*calls[0])[0]["text"], "Edit app.py")

    def test_early_56_loose_object_literal_is_read_without_eval(self) -> None:
        script = '''
const result = await tools.exec_command({cmd:"git status --short",workdir:".",yield_time_ms:10000});
'''
        call = iter_tool_calls(
            _entry({"type": "custom_tool_call", "name": "exec", "input": script})
        )[0]
        self.assertEqual(runtime_tool_events(*call)[0]["text"], "Git status --short")

    def test_template_command_is_displayed_but_not_evaluated(self) -> None:
        script = '''
const result = await tools.exec_command({cmd:`nl -ba ${file} | head`,workdir:"."});
'''
        call = iter_tool_calls(
            _entry({"type": "custom_tool_call", "name": "exec", "input": script})
        )[0]
        self.assertEqual(runtime_tool_events(*call)[0]["text"], "Read head")

    def test_unresolved_command_shorthand_has_visible_fallback(self) -> None:
        script = "const result = await tools.exec_command({cmd,workdir:'.'});"
        call = iter_tool_calls(
            _entry({"type": "custom_tool_call", "name": "exec", "input": script})
        )[0]
        self.assertEqual(runtime_tool_events(*call)[0]["text"], "Shell exec_command")

    def test_truncated_exec_wrapper_recovers_inner_tool(self) -> None:
        script = 'const r = await tools.exec_command({cmd:"pwd",workdir:"."}'
        calls = iter_tool_calls(
            _entry({"type": "custom_tool_call", "name": "exec", "input": script})
        )
        self.assertEqual(calls[0][0], "exec_command")
        self.assertEqual(runtime_tool_events(*calls[0])[0]["text"], "Explore pwd")

    def test_exec_without_nested_tool_is_not_displayed(self) -> None:
        script = 'const matches = ALL_TOOLS.filter(x => x.name === "exec_command"); text(matches);'
        self.assertEqual(
            iter_tool_calls(_entry({"type": "custom_tool_call", "name": "exec", "input": script})),
            [],
        )

    def test_regex_literal_before_awaited_tool_uses_second_pass(self) -> None:
        script = r'''
const escaped = msg.replace(/'/g, `'\\''`);
const r = await tools.exec_command({"cmd":"pwd","workdir":"."});
'''
        calls = iter_tool_calls(
            _entry({"type": "custom_tool_call", "name": "exec", "input": script})
        )
        self.assertEqual([name for name, _ in calls], ["exec_command"])
        self.assertEqual(runtime_tool_events(*calls[0])[0]["text"], "Explore pwd")

    def test_56_special_payload_types_are_visible(self) -> None:
        web = iter_tool_calls(
            _entry({"type": "web_search_call", "action": {"type": "search", "query": "Codex 5.6"}})
        )
        search = iter_tool_calls(
            _entry({"type": "tool_search_call", "arguments": {"query": "spawn agent"}})
        )
        self.assertEqual(runtime_tool_events(*web[0])[0]["text"], "Search Codex 5.6")
        self.assertEqual(runtime_tool_events(*search[0])[0]["text"], "Tool Search spawn agent")

    def test_unknown_56_tool_uses_generic_fallback(self) -> None:
        events = runtime_tool_events("future_connector", {"value": 1})
        self.assertEqual(events[0]["text"], "Tool future_connector")

    def test_polling_transport_calls_remain_quiet(self) -> None:
        self.assertEqual(runtime_tool_events("wait", {"cell_id": "1"}), [])
        self.assertEqual(runtime_tool_events("write_stdin", {"session_id": 1}), [])

    def test_55_envelope_is_retired_from_active_parser(self) -> None:
        old = _entry({"type": "function_call", "name": "exec_command", "arguments": '{"cmd":"pwd"}'})
        self.assertEqual(iter_tool_calls(old), [])


if __name__ == "__main__":
    unittest.main()
