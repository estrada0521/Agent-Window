from __future__ import annotations

import io
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from backend_core.tmux.session import resolve_tmux_session_name
from server import server as chat_server
from server.routes.write import _post_open_terminal


class _JsonHandler:
    def __init__(self, body: bytes = b"{}"):
        self.headers = {"Content-Length": str(len(body))}
        self.rfile = io.BytesIO(body)
        self.response = None

    def _send_json(self, status, body):
        self.response = (status, body)


class RenamedSessionRouteTests(unittest.TestCase):
    def test_new_chat_hands_off_to_current_workspace_claim(self) -> None:
        old_pending = chat_server.chat_restart_pending
        try:
            chat_server.chat_restart_pending = False
            fake_server = mock.Mock()
            completed = SimpleNamespace(returncode=0)
            with (
                mock.patch.object(chat_server, "workspace", "/work/project"),
                mock.patch.object(chat_server, "session_name", "old-aw-name"),
                mock.patch.object(chat_server, "_repo_root", Path("/repo")),
                mock.patch.object(chat_server, "server", fake_server),
                mock.patch.object(chat_server, "find_session_for_workspace", return_value="renamed-aw-session"),
                mock.patch.object(chat_server, "_clean_env", return_value={}),
                mock.patch.object(chat_server.subprocess, "run", return_value=completed) as run,
            ):
                ok, detail, owns_restart = chat_server.queue_chat_restart()

            self.assertTrue(ok)
            self.assertEqual(detail, "")
            self.assertTrue(owns_restart)
            fake_server.shutdown.assert_called_once_with()
            fake_server.server_close.assert_called_once_with()
            self.assertEqual(
                run.call_args.args[0],
                ["/repo/bin/agent-index", "--chat", "--session", "renamed-aw-session"],
            )
        finally:
            chat_server.chat_restart_pending = old_pending

    def test_terminal_attaches_to_real_tmux_name_after_aw_rename(self) -> None:
        handler = _JsonHandler()
        runtime = SimpleNamespace(
            session_is_active=True,
            tmux_session_name="workspace-derived-tmux",
        )
        size_result = SimpleNamespace(returncode=0, stdout="160 48")
        ctx = {
            "runtime": runtime,
            "tmux_socket": "agent-window",
            "session_name": "renamed-aw-session",
        }

        with (
            mock.patch("server.routes.write.subprocess.run", return_value=size_result) as run,
            mock.patch("server.routes.write.subprocess.Popen") as popen,
        ):
            _post_open_terminal(handler, None, ctx)

        self.assertEqual(handler.response, (200, {"ok": True}))
        self.assertIn("=workspace-derived-tmux:0", run.call_args.args[0])
        apple_script = popen.call_args.args[0][-1]
        self.assertIn("attach-session -t workspace-derived-tmux", apple_script)
        self.assertNotIn("renamed-aw-session", apple_script)

    def test_tmux_resolution_does_not_hide_query_failure_as_inactive(self) -> None:
        runtime = SimpleNamespace(
            session_name="renamed-aw-session",
            workspace="/work/project",
            tmux_prefix=["tmux", "-L", "agent-window"],
        )
        failed = SimpleNamespace(returncode=1, stdout="", stderr="tmux unavailable")

        with self.assertRaisesRegex(RuntimeError, "tmux list-sessions failed"):
            resolve_tmux_session_name(
                runtime,
                subprocess_module=SimpleNamespace(run=lambda *_args, **_kwargs: failed),
            )


if __name__ == "__main__":
    unittest.main()
