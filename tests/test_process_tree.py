from __future__ import annotations

import subprocess
import unittest
from unittest.mock import patch

from native_log_sync.agents._shared.process_tree import lsof_text, process_tree


class ProcessTreeTests(unittest.TestCase):
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
