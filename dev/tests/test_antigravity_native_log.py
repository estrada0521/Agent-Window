from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from native_log_sync.agents.gemini.read_runtime import (
    iter_tool_calls,
    load_antigravity_transcript_entries,
    parse_antigravity_planner_step,
    parse_antigravity_transcript_step,
    runtime_tool_events,
)
from native_log_sync.agents.gemini.read_updates import _sync_antigravity_db
from native_log_sync.agents.gemini.resolve_path import _resolve_antigravity_conversation_db
from native_log_sync.agents._shared.path_state import _normalized_native_log_path
from native_log_sync.entry_kind import should_omit_entry_from_chat


def _varint(value: int) -> bytes:
    out = bytearray()
    while value >= 0x80:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def _field(number: int, value: bytes | str) -> bytes:
    raw = value.encode() if isinstance(value, str) else value
    return _varint((number << 3) | 2) + _varint(len(raw)) + raw


def _planner_payload(
    *, text: str = "", calls: list[tuple[str, dict]] | None = None, outer_field: int = 20
) -> bytes:
    planner = _field(3, "**Internal reasoning that must not become a chat message**")
    if text:
        planner += _field(1, text) + _field(8, text)
    for name, args in calls or []:
        tool = _field(2, name) + _field(3, json.dumps(args)) + _field(9, name)
        planner += _field(7, tool)
    return _field(outer_field, planner)


def _create_db(path: Path, rows: list[tuple[int, int, bytes]]) -> None:
    with sqlite3.connect(path) as conn:
        conn.execute("create table steps (idx integer, step_type integer, step_payload blob)")
        conn.executemany("insert into steps values (?, ?, ?)", rows)


class AntigravityPayloadTests(unittest.TestCase):
    def test_visible_response_uses_schema_fields_not_longest_protobuf_string(self) -> None:
        visible = "通常の回答です。"
        text, calls = parse_antigravity_planner_step(_planner_payload(text=visible))
        self.assertEqual(text, visible)
        self.assertEqual(calls, [])

    def test_tool_call_is_structured_and_never_becomes_plain_text(self) -> None:
        payload = _planner_payload(
            calls=[
                (
                    "replace_file_content",
                    {"TargetFile": "/workspace/app.py", "toolSummary": "Edit app"},
                )
            ]
        )
        text, calls = parse_antigravity_planner_step(payload)
        self.assertEqual(text, "")
        self.assertEqual(calls[0][0], "replace_file_content")
        self.assertEqual(calls[0][1]["TargetFile"], "/workspace/app.py")

    def test_visible_text_is_preserved_when_the_same_step_also_calls_tools(self) -> None:
        payload = _planner_payload(
            text="調査を続けます。",
            calls=[("list_dir", {"DirectoryPath": "/workspace"})],
        )
        text, calls = parse_antigravity_planner_step(payload)
        self.assertEqual(text, "調査を続けます。")
        self.assertEqual([name for name, _args in calls], ["list_dir"])

    def test_multiple_calls_and_outer_field_renumbering_are_supported(self) -> None:
        payload = _planner_payload(
            calls=[("list_dir", {"DirectoryPath": "/a"}), ("view_file", {"AbsolutePath": "/a/b"})],
            outer_field=77,
        )
        _text, calls = parse_antigravity_planner_step(payload)
        self.assertEqual([name for name, _args in calls], ["list_dir", "view_file"])

    def test_malformed_or_unrelated_payload_fails_closed(self) -> None:
        self.assertEqual(parse_antigravity_planner_step(b"\xff\xff"), ("", []))
        self.assertEqual(parse_antigravity_planner_step(_field(5, "replace_file_content")), ("", []))

    def test_structured_response_is_not_rejected_by_legacy_pollution_filter(self) -> None:
        self.assertFalse(
            should_omit_entry_from_chat(
                {
                    "sender": "gemini",
                    "message": "replace_file_content",
                    "native_log_kind": "antigravity_assistant_response",
                }
            )
        )
        self.assertTrue(should_omit_entry_from_chat({"sender": "gemini", "message": "replace_file_content"}))

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

    def test_transcript_loader_merges_rotated_full_log(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            base = Path(td) / ".gemini/antigravity-cli"
            db = base / "conversations/conversation.db"
            db.parent.mkdir(parents=True)
            db.touch()
            logs = base / "brain/conversation/.system_generated/logs"
            logs.mkdir(parents=True)
            (logs / "transcript.jsonl").write_text(
                json.dumps({"step_index": 1, "source": "MODEL", "content": "truncated"}) + "\n"
            )
            (logs / "transcript_full.jsonl").write_text(
                json.dumps({"step_index": 1, "source": "MODEL", "content": "full"}) + "\n"
            )
            entries = load_antigravity_transcript_entries(str(db))
        self.assertEqual(entries[1]["content"], "full")


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


class _FakeRuntime:
    def __init__(self, index_path: Path) -> None:
        self.index_path = index_path
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


class AntigravitySyncTests(unittest.TestCase):
    def test_sync_falls_back_to_native_transcript_when_db_envelope_is_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            base = Path(td) / ".gemini/antigravity-cli"
            db = base / "conversations/conversation.db"
            db.parent.mkdir(parents=True)
            _create_db(db, [(0, 15, _field(99, "future schema")), (1, 14, b"next")])
            logs = base / "brain/conversation/.system_generated/logs"
            logs.mkdir(parents=True)
            (logs / "transcript.jsonl").write_text(
                json.dumps(
                    {
                        "step_index": 0,
                        "source": "MODEL",
                        "type": "PLANNER_RESPONSE",
                        "content": "transcript fallback",
                    }
                )
                + "\n"
            )
            out = Path(td) / "session.jsonl"
            runtime = _FakeRuntime(out)
            appended = _sync_antigravity_db(runtime, "gemini", str(db))
            entries = [json.loads(line) for line in out.read_text().splitlines()]

        self.assertTrue(appended)
        self.assertEqual([entry["message"] for entry in entries], ["transcript fallback"])

    def test_sync_writes_only_visible_response_and_publishes_tool_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = root / "conversation.db"
            out = root / "session.jsonl"
            _create_db(
                db,
                [
                    (0, 15, _planner_payload(calls=[("replace_file_content", {"TargetFile": "/workspace/app.py"})])),
                    (1, 5, b"tool result"),
                    (2, 15, _planner_payload(text="完了しました。")),
                    (3, 14, b"next user input"),
                ],
            )
            runtime = _FakeRuntime(out)
            runtime._native_log_progress[_normalized_native_log_path(str(db))] = 0
            appended = _sync_antigravity_db(runtime, "gemini", str(db))
            entries = [json.loads(line) for line in out.read_text().splitlines()]

        self.assertTrue(appended)
        self.assertEqual([entry["message"] for entry in entries], ["完了しました。"])
        self.assertEqual(entries[0]["msg_id"], "antigravity-v2:conversation:2")
        self.assertEqual(entries[0]["native_log_kind"], "antigravity_assistant_response")
        self.assertEqual(
            runtime._idle_running_display_by_agent["gemini"]["current_event"]["text"],
            "Edit app.py",
        )
        self.assertEqual(runtime.idled, ["gemini"])

    def test_existing_cursor_does_not_backfill_earlier_responses(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db = root / "conversation.db"
            out = root / "session.jsonl"
            _create_db(
                db,
                [
                    (0, 15, _planner_payload(text="過去の本文")),
                    (1, 14, b"next user input"),
                ],
            )
            runtime = _FakeRuntime(out)
            runtime._native_log_progress[_normalized_native_log_path(str(db))] = 2
            appended = _sync_antigravity_db(runtime, "gemini", str(db))

        self.assertFalse(appended)
        self.assertFalse(out.exists())
        self.assertNotIn("gemini", runtime._idle_running_display_by_agent)


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
            conversations = base / "conversations"
            conversations.mkdir(parents=True)
            valid = conversations / "valid.db"
            valid.touch()
            lines = [
                {"workspace": "/workspace/current", "conversationId": "valid"},
                *({"workspace": f"/workspace/other-{i}", "conversationId": f"other-{i}"} for i in range(250)),
                {"workspace": "/workspace/current", "conversationId": "deleted"},
            ]
            (base / "history.jsonl").write_text("\n".join(json.dumps(line) for line in lines))
            with patch("native_log_sync.agents.gemini.resolve_path.Path.home", return_value=home):
                resolved = _resolve_antigravity_conversation_db(_ResolveRuntime(), _ResolveRuntime.workspace)
        self.assertEqual(resolved, str(valid))

    def test_resolver_never_falls_back_to_another_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            home = Path(td)
            base = home / ".gemini/antigravity-cli"
            conversations = base / "conversations"
            conversations.mkdir(parents=True)
            (conversations / "other.db").touch()
            (base / "history.jsonl").write_text(
                json.dumps({"workspace": "/workspace/other", "conversationId": "other"})
            )
            with patch("native_log_sync.agents.gemini.resolve_path.Path.home", return_value=home):
                resolved = _resolve_antigravity_conversation_db(_ResolveRuntime(), _ResolveRuntime.workspace)
        self.assertEqual(resolved, "")


if __name__ == "__main__":
    unittest.main()
