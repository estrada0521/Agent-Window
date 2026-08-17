from __future__ import annotations

import os
import subprocess
import unittest
from unittest.mock import patch

from native_log_sync.agents._shared.process_tree import lsof_text, process_tree


class ProcessTreeTests(unittest.TestCase):
    def test_empty_pid_is_empty(self) -> None:
        self.assertEqual(process_tree(""), set())
        self.assertIsNone(lsof_text(""))

    def test_tree_includes_the_given_pid(self) -> None:
        pid = str(os.getpid())
        self.assertIn(pid, process_tree(pid))

    def test_ps_unread_keeps_the_given_pid(self) -> None:
        with patch(
            "native_log_sync.agents._shared.process_tree.subprocess.run",
            side_effect=FileNotFoundError("ps"),
        ):
            self.assertEqual(process_tree("123"), {"123"})

    def test_unexpected_ps_error_is_not_swallowed(self) -> None:
        with patch(
            "native_log_sync.agents._shared.process_tree.subprocess.run",
            side_effect=ValueError("boom"),
        ):
            with self.assertRaises(ValueError):
                process_tree("123")

    def test_unreadable_pid_lsof_is_none(self) -> None:
        with patch(
            "native_log_sync.agents._shared.process_tree.subprocess.run",
            side_effect=subprocess.CalledProcessError(1, "lsof"),
        ):
            self.assertIsNone(lsof_text("123"))
