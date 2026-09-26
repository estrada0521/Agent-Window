from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from tmux.session import find_session_for_workspace
from fs.log.paths import workspace_timeline_port
from server.timeline import server as timeline_server
from server.timeline.routes.write import _post_open_terminal
from server.timeline.binding import WorkspaceTimelineBinding


class _JsonHandler:
    def __init__(self, body: bytes = b"{}"):
        self.headers = {"Content-Length": str(len(body))}
        self.rfile = io.BytesIO(body)
        self.response = None

    def _send_json(self, status, body):
        self.response = (status, body)


class RenamedTimelineRouteTests(unittest.TestCase):
    def test_reload_timeline_restarts_the_current_workspace_without_an_aw_name(self) -> None:
        old_pending = timeline_server.timeline_restart_pending
        try:
            timeline_server.timeline_restart_pending = False
            fake_server = mock.Mock()
            with (
                mock.patch.object(timeline_server, "workspace", "/work/project"),
                mock.patch.object(timeline_server, "server", fake_server),
                mock.patch.object(timeline_server, "_restart_env", return_value={}),
                mock.patch.object(timeline_server, "launch_timeline_server", return_value=object()) as launch,
                mock.patch.object(timeline_server, "wait_for_timeline_server", return_value=""),
            ):
                ok, detail, owns_restart = timeline_server.queue_timeline_restart()

            self.assertTrue(ok)
            self.assertEqual(detail, "")
            self.assertTrue(owns_restart)
            fake_server.shutdown.assert_called_once_with()
            fake_server.server_close.assert_called_once_with()
            launch.assert_called_once_with("/work/project", env={})
        finally:
            timeline_server.timeline_restart_pending = old_pending

    def test_running_server_binding_follows_a_folder_rename_without_changing_port(self) -> None:
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
                port_before = workspace_timeline_port(workspace)
                old_dir.rename(root / "new-label")
                timeline_name, log_path = binding.snapshot()

            self.assertEqual(timeline_name, "new-label")
            self.assertEqual(log_path, root / "new-label" / ".log.jsonl")
            self.assertEqual(workspace_timeline_port(workspace), port_before)

    def test_terminal_attaches_to_real_tmux_name_after_aw_rename(self) -> None:
        handler = _JsonHandler()
        state = SimpleNamespace(
            session_is_active=True,
            tmux_session_name="opaque-tmux-7",
        )
        size_result = SimpleNamespace(returncode=0, stdout="160 48")
        ctx = {
            "state": state,
            "timeline_name": "renamed-aw-timeline",
        }

        with (
            mock.patch("server.timeline.routes.write.subprocess.run", return_value=size_result) as run,
            mock.patch("server.timeline.routes.write.subprocess.Popen") as popen,
        ):
            _post_open_terminal(handler, None, ctx)

        self.assertEqual(handler.response, (200, {"ok": True}))
        self.assertIn("=opaque-tmux-7:0", run.call_args.args[0])
        apple_script = popen.call_args.args[0][-1]
        self.assertIn("attach-session -t opaque-tmux-7", apple_script)
        self.assertNotIn("renamed-aw-timeline", apple_script)

    def test_tmux_resolution_does_not_hide_query_failure_as_inactive(self) -> None:
        failed = SimpleNamespace(returncode=1, stdout="", stderr="tmux unavailable")

        with self.assertRaisesRegex(RuntimeError, "tmux list-sessions failed"):
            with mock.patch(
                "tmux.session.subprocess.run",
                return_value=failed,
            ):
                find_session_for_workspace("/work/project")

if __name__ == "__main__":
    unittest.main()
