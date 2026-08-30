from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend_core.tmux.control import SessionControlError, _create_tmux_session, _own_chat_listener_pids


class TmuxIdentityTests(unittest.TestCase):
    def test_tmux_allocates_its_own_opaque_session_name(self) -> None:
        created = SimpleNamespace(returncode=0, stdout="7\n", stderr="")
        with patch("backend_core.tmux.control._run", return_value=created) as run:
            tmux_name = _create_tmux_session(["tmux", "-L", "dummy"], Path("/workspace/project"))

        self.assertEqual(tmux_name, "7")
        prefix, args = run.call_args.args
        self.assertEqual(prefix, ["tmux", "-L", "dummy"])
        self.assertIn("-P", args)
        self.assertEqual(args[args.index("-F") + 1], "#{session_name}")
        self.assertNotIn("-s", args)


class ChatServerIdentityTests(unittest.TestCase):
    def test_listener_is_owned_by_its_reported_workspace_and_pid(self) -> None:
        workspace = "/work/project with spaces"
        with (
            patch("backend_core.tmux.control._chat_listener_pids", return_value=[4123]),
            patch(
                "backend_core.tmux.control.read_chat_server_state",
                return_value={"pid": 4123, "workspace": workspace},
            ),
        ):
            self.assertEqual(_own_chat_listener_pids(38000, workspace), [4123])

    def test_listener_from_another_workspace_is_never_signaled(self) -> None:
        with (
            patch("backend_core.tmux.control._chat_listener_pids", return_value=[4123]),
            patch(
                "backend_core.tmux.control.read_chat_server_state",
                return_value={"pid": 4123, "workspace": "/work/other"},
            ),
        ):
            with self.assertRaisesRegex(SessionControlError, "not this workspace"):
                _own_chat_listener_pids(38000, "/work/project")


if __name__ == "__main__":
    unittest.main()
