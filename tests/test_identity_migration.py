from __future__ import annotations

import json
import tempfile
import threading
import unittest
from pathlib import Path

from backend_core.access.session_meta import write_session_meta_file
from backend_core.agents.instances import renumber_exact_instance
from native_log_sync.agents._shared.runtime_state import rename_agent_identity
from native_log_sync.refresh.binding_models import NativeLogBinding


class RenumberExactInstanceTests(unittest.TestCase):
    def test_second_instance_renames_bare_name(self) -> None:
        current, rename = renumber_exact_instance(["claude"], "claude")
        self.assertEqual(current, ["claude-1"])
        self.assertEqual(rename, ("claude", "claude-1"))

    def test_no_rename_when_already_numbered(self) -> None:
        current, rename = renumber_exact_instance(["claude-1"], "claude")
        self.assertEqual(current, ["claude-1"])
        self.assertIsNone(rename)

    def test_no_rename_when_base_has_no_existing_bare_instance(self) -> None:
        current, rename = renumber_exact_instance(["claude", "codex"], "grok")
        self.assertEqual(current, ["claude", "codex"])
        self.assertIsNone(rename)


class SessionMetaDisplayNameRenameTests(unittest.TestCase):
    def _write_and_read(self, *, rename) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "session.log.jsonl"
            meta_path = log_path.parent / ".meta"
            meta_path.write_text(json.dumps({"agent_names": {"claude": "Fable"}}), encoding="utf-8")
            tmux_env = f"AGENT_WINDOW_INDEX_PATH={log_path}\nAGENT_WINDOW_WORKSPACE=/tmp/ws\n"
            write_session_meta_file("sess", "claude-1,claude-2", tmux_env, rename=rename)
            return json.loads(meta_path.read_text(encoding="utf-8"))

    def test_display_name_survives_a_rename(self) -> None:
        meta = self._write_and_read(rename=("claude", "claude-1"))
        self.assertEqual(meta["agent_names"], {"claude-1": "Fable"})

    def test_without_a_rename_hint_the_old_name_is_dropped(self) -> None:
        meta = self._write_and_read(rename=None)
        self.assertNotIn("agent_names", meta)


class NativeLogRenameIdentityTests(unittest.TestCase):
    def _runtime(self):
        class _Runtime:
            pass

        runtime = _Runtime()
        runtime._native_log_bindings_lock = threading.Lock()
        runtime._native_log_bindings_by_agent = {}
        runtime._native_log_watch_reconfigure = threading.Event()
        runtime._agent_first_seen_ts = {}
        runtime._native_log_projection_status = {}
        runtime._native_log_blocked_paths = {}
        return runtime

    def test_migrates_every_agent_keyed_store(self) -> None:
        runtime = self._runtime()
        binding = NativeLogBinding(
            agent="claude",
            base="claude",
            pane_id="%1",
            pane_pid="123",
            path="/x/log.jsonl",
            watch_roots=("/x",),
            source="pid",
        )
        runtime._native_log_bindings_by_agent["claude"] = binding
        runtime._agent_first_seen_ts["claude"] = 100.0
        runtime._native_log_projection_status["claude"] = {"status": "warning", "detail": "x"}
        runtime._native_log_blocked_paths["claude"] = "/x/old-log.jsonl"

        rename_agent_identity(runtime, "claude", "claude-1")

        self.assertNotIn("claude", runtime._native_log_bindings_by_agent)
        migrated = runtime._native_log_bindings_by_agent["claude-1"]
        self.assertEqual(migrated.agent, "claude-1")
        self.assertEqual(migrated.path, "/x/log.jsonl")
        self.assertEqual(runtime._agent_first_seen_ts, {"claude-1": 100.0})
        self.assertEqual(
            runtime._native_log_projection_status,
            {"claude-1": {"status": "warning", "detail": "x"}},
        )
        self.assertEqual(runtime._native_log_blocked_paths, {"claude-1": "/x/old-log.jsonl"})
        self.assertTrue(runtime._native_log_watch_reconfigure.is_set())

    def test_no_op_when_old_name_has_no_state(self) -> None:
        runtime = self._runtime()
        rename_agent_identity(runtime, "claude", "claude-1")
        self.assertEqual(runtime._native_log_bindings_by_agent, {})
        self.assertEqual(runtime._agent_first_seen_ts, {})


if __name__ == "__main__":
    unittest.main()
