from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from server.timeline.control import _create_tmux_session


class TmuxIdentityTests(unittest.TestCase):
    def test_tmux_allocates_its_own_opaque_timeline_name(self) -> None:
        created = SimpleNamespace(returncode=0, stdout="7\n", stderr="")
        with patch("server.timeline.control.run_tmux", return_value=created) as run:
            tmux_name = _create_tmux_session(Path("/workspace/project"))

        self.assertEqual(tmux_name, "7")
        (args,) = run.call_args.args
        self.assertIn("-P", args)
        self.assertEqual(args[args.index("-F") + 1], "#{session_name}")
        self.assertNotIn("-s", args)


if __name__ == "__main__":
    unittest.main()
