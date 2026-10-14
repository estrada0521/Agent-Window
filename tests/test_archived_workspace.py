from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fs.log.paths import workspace_timeline_path
from server.hub.timeline_query import LiveTimelines, archived_timeline_records, build_timeline_record
from git import repo as workspace_git


class ArchivedWorkspaceTests(unittest.TestCase):
    def test_archived_timelines_keep_a_non_git_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "Lab-workspace"
            workspace.mkdir()
            root = Path(tmp) / "log"
            log_dir = root / "Lab"
            log_dir.mkdir(parents=True)
            (log_dir / ".log.jsonl").write_text("", encoding="utf-8")
            (log_dir / ".meta").write_text(
                json.dumps(
                    {
                        "workspace": str(workspace),
                        "agents": ["codex"],
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            hub_repo = "/Users/okadaharuto/workspace/Agent-Window"
            with patch("fs.log.paths.agent_window_root", return_value=Path(tmp)):
                timelines = archived_timeline_records(LiveTimelines({}, "ok"))
            self.assertEqual(len(timelines), 1)
            self.assertEqual(timelines[0]["name"], "Lab")
            self.assertEqual(timelines[0]["workspace"], str(workspace))
            self.assertNotEqual(timelines[0]["workspace"], hub_repo)
            self.assertFalse((workspace / ".git").exists())

    def test_archived_record_points_to_saved_workspace_not_hub_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "Even-Parity"
            workspace.mkdir()
            with patch("server.hub.timeline_query.latest_message_preview", return_value={"sender": "", "text": "", "revision": ""}):
                record = build_timeline_record(name="Even-Parity", workspace=str(workspace))
        self.assertEqual(record["timeline_url"], workspace_timeline_path(workspace) + "/")
        self.assertFalse(record["timeline_url"].startswith(workspace_timeline_path("/Users/okadaharuto/workspace/Agent-Window") + "/"))

    def test_git_overview_does_not_use_hub_repo_as_the_project(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "git workspace is not configured"):
            workspace_git.git_overview("")
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(str(workspace_git._git_root(tmp)), tmp)
            self.assertNotEqual(str(workspace_git._git_root(tmp)), "/Users/okadaharuto/workspace/Agent-Window")
        with self.assertRaisesRegex(RuntimeError, "Workspace not found"):
            workspace_git.git_overview("/no/such/even-parity")

    def test_mirrors_link_inside_an_existing_workspace(self) -> None:
        from fs.log.paths import (
            LOG_FILENAME,
            ensure_workspace_log_link,
        )

        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "Lab"
            workspace.mkdir()
            canonical = Path(tmp) / "log"
            canonical.mkdir()
            log_target = canonical / LOG_FILENAME
            log_target.write_text("", encoding="utf-8")
            with patch("fs.log.paths.log_jsonl_path", return_value=log_target):
                ensure_workspace_log_link("Lab", str(workspace))
            link = workspace / ".agent-window" / LOG_FILENAME
            self.assertTrue(link.is_symlink())
            self.assertEqual(link.resolve(), log_target.resolve())

if __name__ == "__main__":
    unittest.main()
