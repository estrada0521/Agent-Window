from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from tmux.session import find_session_for_workspace
from fs.log.paths import workspace_timeline_path
from server.timeline.binding import WorkspaceTimelineBinding


class RenamedTimelineRouteTests(unittest.TestCase):
    def test_timeline_binding_follows_a_folder_rename_without_changing_url(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "timelines"
            workspace = Path(tmp) / "workspace"
            root.mkdir()
            workspace.mkdir()
            old_dir = root / "old-label"
            old_dir.mkdir()
            (old_dir / ".log.jsonl").write_text("", encoding="utf-8")
            (old_dir / ".meta").write_text(
                json.dumps({"workspace": str(workspace)}) + "\n",
                encoding="utf-8",
            )

            with (
                mock.patch("server.timeline.binding.agent_window_log_root", return_value=root),
                mock.patch("fs.log.meta.agent_window_log_root", return_value=root),
                mock.patch("fs.log.paths.agent_window_log_root", return_value=root),
            ):
                binding = WorkspaceTimelineBinding(workspace)
                path_before = workspace_timeline_path(workspace)
                old_dir.rename(root / "new-label")
                timeline_name, log_path = binding.snapshot()

            self.assertEqual(timeline_name, "new-label")
            self.assertEqual(log_path, root / "new-label" / ".log.jsonl")
            self.assertEqual(workspace_timeline_path(workspace), path_before)

    def test_tmux_resolution_does_not_hide_query_failure_as_inactive(self) -> None:
        failed = SimpleNamespace(returncode=1, stdout="", stderr="tmux unavailable")

        with self.assertRaisesRegex(RuntimeError, "tmux list-sessions failed"):
            with mock.patch(
                "tmux.session.run_tmux",
                return_value=failed,
            ):
                find_session_for_workspace("/work/project")

if __name__ == "__main__":
    unittest.main()
