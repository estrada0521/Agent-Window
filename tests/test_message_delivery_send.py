from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from message_delivery.send import (
    session_topology_lock_path,
)


class SessionTopologyLockPathTests(unittest.TestCase):
    def test_returns_lock_file_under_run_dir(self):
        with patch.dict("os.environ", {"AGENT_WINDOW_RUN_DIR": "/tmp/agent-window-run"}):
            path = session_topology_lock_path("agent-window", "demo-session")
        self.assertEqual(path.parent, Path("/tmp/agent-window-run/topology-locks"))
        self.assertTrue(path.name.endswith(".lock"))

    def test_stable_for_same_inputs(self):
        with patch.dict("os.environ", {"AGENT_WINDOW_RUN_DIR": "/tmp/agent-window-run"}):
            first = session_topology_lock_path("agent-window", "demo-session")
            second = session_topology_lock_path("agent-window", "demo-session")
        self.assertEqual(first, second)

    def test_differs_by_session_name(self):
        with patch.dict("os.environ", {"AGENT_WINDOW_RUN_DIR": "/tmp/agent-window-run"}):
            a = session_topology_lock_path("agent-window", "session-a")
            b = session_topology_lock_path("agent-window", "session-b")
        self.assertNotEqual(a, b)

    def test_handles_missing_session_name(self):
        with patch.dict("os.environ", {"AGENT_WINDOW_RUN_DIR": "/tmp/agent-window-run"}):
            path = session_topology_lock_path("agent-window", "")
        self.assertTrue(path.name.endswith(".lock"))


if __name__ == "__main__":
    unittest.main()
