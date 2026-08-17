from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from native_log_sync.agents.gemini.read_runtime import (
    iter_tool_calls,
    parse_antigravity_transcript_step,
    runtime_tool_events,
)
from native_log_sync.agents.gemini.read_updates import sync_gemini_native_log
from native_log_sync.agents.gemini.resolve_path import _resolve_antigravity_transcript


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
        self._native_log_progress = {}
        self._native_log_current_paths = {}
        self._idle_running_event_seq = 0
        self._idle_running_display_by_agent = {}
        self.saved = 0
        self.idled = []

    def save_sync_state(self) -> None:
        self.saved += 1

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

    def test_transcript_fallback_unquotes_cli_rendered_arguments(self) -> None:
        entry = {
            "source": "MODEL",
            "type": "PLANNER_RESPONSE",
            "content": "fallback response",
            "tool_calls": [
                {"name": "view_file", "args": {"AbsolutePath": '"/workspace/app.py"'}}
            ],
        }
        self.assertEqual(
            parse_antigravity_transcript_step(entry),
            ("fallback response", [("view_file", {"AbsolutePath": "/workspace/app.py"})]),
        )

    def test_non_planner_model_rows_are_ignored(self) -> None:
        self.assertEqual(
            parse_antigravity_transcript_step(
                {"source": "MODEL", "type": "VIEW_FILE", "content": "file body"}
            ),
            ("", []),
        )


class AntigravityRuntimeTests(unittest.TestCase):
    def test_all_observed_tool_families_have_stable_runtime_output(self) -> None:
        cases = {
            "view_file": ({"AbsolutePath": "/workspace/src/a.py"}, "Read src/a.py"),
            "list_dir": ({"DirectoryPath": "/workspace/src"}, "Explore src"),
            "grep_search": ({"Query": "needle", "SearchPath": "/workspace/src"}, "Search needle in src"),
            "find_by_name": ({"Pattern": "*.py", "SearchDirectory": "/workspace"}, "Search *.py in ."),
            "run_command": ({"CommandLine": "git status --short"}, "Git status --short"),
            "replace_file_content": ({"TargetFile": "/workspace/a.py"}, "Edit a.py"),
            "multi_replace_file_content": ({"TargetFile": "/workspace/a.py"}, "Edit a.py"),
            "write_to_file": ({"TargetFile": "/workspace/new.py"}, "Write new.py"),
            "search_web": ({"query": "Antigravity CLI"}, "Web Antigravity CLI"),
            "define_subagent": ({"toolSummary": "Define auditor"}, "Agent Define auditor"),
            "invoke_subagent": ({"toolSummary": "Launch auditors"}, "Agent Launch auditors"),
            "send_message": ({"Recipient": "root"}, "Message root"),
        }
        for name, (args, expected) in cases.items():
            with self.subTest(name=name):
                self.assertEqual(runtime_tool_events(name, args, workspace="/workspace")[0]["text"], expected)

        self.assertEqual(runtime_tool_events("command_status", {"CommandId": "x"}), [])
        self.assertEqual(runtime_tool_events("manage_task", {"Action": "status"}), [])
        self.assertEqual(runtime_tool_events("future_tool", {})[0]["text"], "Tool future_tool")


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
        self.assertEqual(entries[0]["msg_id"], "antigravity-v2:conversation:2")
        self.assertEqual(
            runtime._idle_running_display_by_agent["gemini"]["current_event"]["text"],
            "Edit app.py",
        )
        self.assertEqual(runtime.idled, ["gemini"])

    def test_wrong_filename_fails_loud(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            truncated = Path(td) / "transcript.jsonl"
            truncated.write_text("{}\n")
            runtime = _FakeRuntime(Path(td) / "session.jsonl")
            with self.assertRaises(RuntimeError):
                sync_gemini_native_log(runtime, "gemini", str(truncated))


class _ResolveRuntime:
    workspace = "/workspace/current"

    @staticmethod
    def _workspace_aliases(workspace: str) -> list[str]:
        return [workspace]


class AntigravityResolveTests(unittest.TestCase):
    def test_resolver_scans_full_history_and_skips_deleted_newest_conversation(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            home = Path(td)
            base = home / ".gemini/antigravity-cli"
            valid = _transcript_path(base, "valid")
            valid.parent.mkdir(parents=True)
            valid.touch()
            lines = [
                {"workspace": "/workspace/current", "conversationId": "valid"},
                *({"workspace": f"/workspace/other-{i}", "conversationId": f"other-{i}"} for i in range(250)),
                {"workspace": "/workspace/current", "conversationId": "deleted"},
            ]
            base.mkdir(parents=True, exist_ok=True)
            (base / "history.jsonl").write_text("\n".join(json.dumps(line) for line in lines))
            with patch("native_log_sync.agents.gemini.resolve_path.Path.home", return_value=home):
                resolved = _resolve_antigravity_transcript(_ResolveRuntime(), _ResolveRuntime.workspace)
        self.assertEqual(resolved, str(valid))

    def test_resolver_never_falls_back_to_another_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            home = Path(td)
            base = home / ".gemini/antigravity-cli"
            other = _transcript_path(base, "other")
            other.parent.mkdir(parents=True)
            other.touch()
            base.mkdir(parents=True, exist_ok=True)
            (base / "history.jsonl").write_text(
                json.dumps({"workspace": "/workspace/other", "conversationId": "other"})
            )
            with patch("native_log_sync.agents.gemini.resolve_path.Path.home", return_value=home):
                resolved = _resolve_antigravity_transcript(_ResolveRuntime(), _ResolveRuntime.workspace)
        self.assertEqual(resolved, "")

    def test_resolver_does_not_bind_truncated_transcript(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            home = Path(td)
            base = home / ".gemini/antigravity-cli"
            logs = base / "brain/only-trunc/.system_generated/logs"
            logs.mkdir(parents=True)
            (logs / "transcript.jsonl").touch()
            (base / "history.jsonl").write_text(
                json.dumps({"workspace": "/workspace/current", "conversationId": "only-trunc"})
            )
            with patch("native_log_sync.agents.gemini.resolve_path.Path.home", return_value=home):
                resolved = _resolve_antigravity_transcript(_ResolveRuntime(), _ResolveRuntime.workspace)
        self.assertEqual(resolved, "")


if __name__ == "__main__":
    unittest.main()
