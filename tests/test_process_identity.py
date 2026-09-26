from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from server.timeline.control import SessionControlError, _create_tmux_session, _own_timeline_listener_pids


class TmuxIdentityTests(unittest.TestCase):
    def test_tmux_allocates_its_own_opaque_timeline_name(self) -> None:
        created = SimpleNamespace(returncode=0, stdout="7\n", stderr="")
        with patch("server.timeline.control._run", return_value=created) as run:
            tmux_name = _create_tmux_session(Path("/workspace/project"))

        self.assertEqual(tmux_name, "7")
        (args,) = run.call_args.args
        self.assertIn("-P", args)
        self.assertEqual(args[args.index("-F") + 1], "#{session_name}")
        self.assertNotIn("-s", args)


class TimelineServerIdentityTests(unittest.TestCase):
    def test_listener_is_owned_by_its_reported_workspace_and_pid(self) -> None:
        workspace = "/work/project with spaces"
        with (
            patch("server.timeline.control._timeline_listener_pids", return_value=[4123]),
            patch(
                "server.timeline.control.read_timeline_server_state",
                return_value={"pid": 4123, "workspace": workspace},
            ),
        ):
            self.assertEqual(_own_timeline_listener_pids(38000, workspace), [4123])

    def test_listener_from_another_workspace_is_never_signaled(self) -> None:
        with (
            patch("server.timeline.control._timeline_listener_pids", return_value=[4123]),
            patch(
                "server.timeline.control.read_timeline_server_state",
                return_value={"pid": 4123, "workspace": "/work/other"},
            ),
        ):
            with self.assertRaisesRegex(SessionControlError, "not this workspace"):
                _own_timeline_listener_pids(38000, "/work/project")


if __name__ == "__main__":
    unittest.main()
