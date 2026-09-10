from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from native_log_sync.agents.gemini.read_runtime import (
    iter_tool_calls,
    parse_antigravity_transcript_step,
    runtime_tool_events,
)
from native_log_sync.agents.gemini.read_updates import sync_gemini_native_log


def _planner(
    step: int,
    content: str = "",
    *,
    tools: list[tuple[str, dict]] | None = None,
    extra: dict | None = None,
) -> dict:
    entry = {
        "step_index": step,
        "source": "MODEL",
        "type": "PLANNER_RESPONSE",
        "content": content,
    }
    if tools:
        entry["tool_calls"] = [{"name": name, "args": args} for name, args in tools]
    if extra:
        entry.update(extra)
    return entry


def _write_jsonl(path: Path, entries: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(entry, ensure_ascii=False) + "\n" for entry in entries))


def _transcript_path(root: Path, conversation_id: str = "conversation") -> Path:
    return (
        root
        / "brain"
        / conversation_id
        / ".system_generated"
        / "logs"
        / "transcript_full.jsonl"
    )


def _projected_messages(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


class _FakeRuntime:
    def __init__(self, log_path: Path) -> None:
        self.log_path = log_path
        self.session_name = "TEST"
        self.workspace = "/workspace"
        self._native_log_read_offsets = {}
        self._native_log_projection_status = {}
        self._idle_running_event_seq = 0
        self._idle_running_display_by_agent = {}
        self.idled = []

    def _mark_idle(self, agent: str) -> None:
        self.idled.append(agent)

    def notify_session_state_changed(self, *_args, **_kwargs) -> None:
        pass


class AntigravityTranscriptTests(unittest.TestCase):
    def test_transcript_tool_calls_are_an_independent_supported_shape(self) -> None:
        entry = {
            "source": "MODEL",
            "type": "PLANNER_RESPONSE",
            "tool_calls": [{"name": "search_web", "args": {"query": "Antigravity"}}],
        }
        self.assertEqual(iter_tool_calls(entry), [("search_web", {"query": "Antigravity"})])
        self.assertEqual(iter_tool_calls({"source": "USER", "tool_calls": entry["tool_calls"]}), [])

    def test_non_planner_model_rows_are_ignored(self) -> None:
        self.assertEqual(
            parse_antigravity_transcript_step(
                {"source": "MODEL", "type": "VIEW_FILE", "content": "file body"}
            ),
            ("", []),
        )


class AntigravityRuntimeTests(unittest.TestCase):
    def test_status_polls_are_quiet_and_unknown_tools_stay_visible(self) -> None:
        self.assertEqual(runtime_tool_events("command_status", {"CommandId": "x"}), [])
        self.assertEqual(runtime_tool_events("manage_task", {"Action": "status"}), [])
        self.assertTrue(runtime_tool_events("future_tool", {})[0]["keyword"])


class AntigravitySyncTests(unittest.TestCase):
    def test_sync_writes_only_visible_response_and_publishes_tool_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            transcript = _transcript_path(root)
            _write_jsonl(transcript, [])
            out = root / "session.jsonl"
            runtime = _FakeRuntime(out)
            sync_gemini_native_log(runtime, "gemini", str(transcript))
            _write_jsonl(
                transcript,
                [
                    _planner(
                        0,
                        tools=[("replace_file_content", {"TargetFile": "/workspace/app.py"})],
                    ),
                    {"step_index": 1, "source": "MODEL", "type": "VIEW_FILE", "content": "file body"},
                    _planner(2, "完了しました。"),
                    {"step_index": 3, "source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "next"},
                ],
            )
            sync_gemini_native_log(runtime, "gemini", str(transcript))
            entries = _projected_messages(out)

        self.assertEqual([entry["message"] for entry in entries], ["完了しました。"])
        self.assertTrue(entries[0]["context_hash"])
        self.assertTrue(runtime._idle_running_display_by_agent["gemini"]["current_event"]["keyword"])
        self.assertEqual(runtime.idled, ["gemini"])

    def test_wrong_filename_fails_loud(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            truncated = Path(td) / "transcript.jsonl"
            truncated.write_text("{}\n")
            runtime = _FakeRuntime(Path(td) / "session.jsonl")
            with self.assertRaises(RuntimeError):
                sync_gemini_native_log(runtime, "gemini", str(truncated))


if __name__ == "__main__":
    unittest.main()
