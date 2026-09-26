from __future__ import annotations

import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from server.hub.supervisor import timeline_server_state_matches, ensure_timeline_server
from server.hub.actions import resolve_timeline_target
from server.hub.timeline_query import LiveTimelines, archived_timeline_records
from git import repo as workspace_git


class ArchivedWorkspaceTests(unittest.TestCase):
    def test_hub_reload_stops_archived_timeline_servers_before_restart(self) -> None:
        from server.hub import server as hub_server

        fake_hub = object()
        with (
            patch.object(hub_server, "hub", fake_hub),
            patch.object(hub_server, "stop_inactive_timeline_servers", return_value=""),
            patch.object(hub_server, "restart_pending", False),
            patch.object(hub_server, "launch_hub_restart", return_value="") as launch,
        ):
            ok, detail, owns_restart = hub_server.queue_hub_restart()
            self.assertTrue(hub_server.restart_pending)

        self.assertTrue(ok)
        self.assertEqual(detail, "")
        self.assertTrue(owns_restart)
        launch.assert_called_once()

    def test_hub_reload_does_not_restart_when_archived_cleanup_fails(self) -> None:
        from server.hub import server as hub_server

        fake_hub = object()
        with (
            patch.object(hub_server, "hub", fake_hub),
            patch.object(hub_server, "stop_inactive_timeline_servers", return_value="cleanup failed"),
            patch.object(hub_server, "restart_pending", False),
            patch.object(hub_server, "launch_hub_restart") as launch,
        ):
            ok, detail, owns_restart = hub_server.queue_hub_restart()
            self.assertFalse(hub_server.restart_pending)

        self.assertFalse(ok)
        self.assertEqual(detail, "cleanup failed")
        self.assertFalse(owns_restart)
        launch.assert_not_called()

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

    def test_archived_open_passes_saved_workspace_not_hub_root(self) -> None:
        captured = {}

        def ensure_timeline_server(_hub, *, expected_active=True, workspace=""):
            captured["expected_active"] = expected_active
            captured["workspace"] = workspace
            return True, 8206, ""

        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "Even-Parity"
            workspace.mkdir()
            with (
                patch("server.hub.actions.live_timelines_query", return_value=LiveTimelines({}, "ok")),
                patch(
                    "server.hub.actions.read_log_meta",
                    return_value={"workspace": str(workspace), "agents": []},
                ),
                patch("server.hub.actions.ensure_timeline_server", side_effect=ensure_timeline_server),
            ):
                resolved = resolve_timeline_target(object(), "Even-Parity")
        self.assertEqual(resolved["status"], "ok")
        self.assertFalse(captured["expected_active"])
        self.assertEqual(captured["workspace"], str(workspace))
        self.assertNotEqual(captured["workspace"], "/Users/okadaharuto/workspace/Agent-Window")

    def test_timeline_server_state_rejects_wrong_workspace(self) -> None:
        repo_root = "/Users/okadaharuto/workspace/Agent-Window"
        state = {
            "timeline": "Even-Parity",
            "repo_root": repo_root,
            "workspace": repo_root,
            "targets": [],
            "active": False,
        }
        hub = SimpleNamespace(
            repo_root=Path(repo_root),
        )
        self.assertFalse(
            timeline_server_state_matches(
                hub,
                state,
                workspace="/Users/okadaharuto/workspace/Even-Parity",
            )
        )
        self.assertTrue(
            timeline_server_state_matches(
                hub,
                state,
                workspace=repo_root,
            )
        )

    def test_archived_launch_argv_is_the_saved_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "Even-Parity"
            workspace.mkdir()
            hub = SimpleNamespace(
                repo_root=Path("/Users/okadaharuto/workspace/Agent-Window"),
                _get_launch_lock=lambda _name: threading.Lock(),
            )
            with (
                patch("server.hub.supervisor.workspace_timeline_port", return_value=8206),
                patch("server.hub.supervisor.port_is_bindable", return_value=True),
                patch("server.hub.supervisor.read_timeline_server_state", return_value=None),
                patch("server.hub.supervisor.stop_inactive_timeline_servers", return_value=""),
                patch("server.hub.supervisor.timeline_launch_env", return_value={}),
                patch("server.hub.supervisor.launch_timeline_server", return_value=object()) as launch,
                patch("server.hub.supervisor.wait_for_timeline_server", return_value=""),
            ):
                ok, port, detail = ensure_timeline_server(
                    hub,
                    expected_active=False,
                    workspace=str(workspace),
                )
        self.assertTrue(ok)
        self.assertEqual(port, 8206)
        self.assertEqual(detail, "")
        self.assertEqual(launch.call_args.args, (str(workspace.resolve()),))

    def test_timeline_launch_cwd_is_not_a_workspace_that_contains_server_py(self) -> None:
        from server.timeline.process import launch_timeline_server

        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "xray-structure-factor"
            workspace.mkdir()
            (workspace / "server.py").write_text("raise SystemExit('shadow')\n", encoding="utf-8")
            with patch("server.timeline.process.subprocess.Popen") as popen:
                launch_timeline_server(workspace, env={})
        launch_cwd = popen.call_args.kwargs["cwd"]
        self.assertEqual(launch_cwd, "/Users/okadaharuto/workspace/Agent-Window")
        self.assertNotEqual(launch_cwd, str(workspace))

    def test_git_overview_does_not_use_hub_repo_as_the_project(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "git workspace is not configured"):
            workspace_git.git_overview("")
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(str(workspace_git._git_root(tmp)), tmp)
            self.assertNotEqual(str(workspace_git._git_root(tmp)), "/Users/okadaharuto/workspace/Agent-Window")
        with self.assertRaisesRegex(RuntimeError, "workspace is not available"):
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
