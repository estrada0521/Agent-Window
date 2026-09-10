import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend_core.tmux.control import SessionControlError, append_session_lifecycle_entry


class SessionLifecycleEntryTests(unittest.TestCase):
    def test_unknown_action_raises_instead_of_silently_dropping(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / ".log.jsonl"
            with patch("backend_core.tmux.control.session_log_path", return_value=log_path):
                with self.assertRaises(SessionControlError):
                    append_session_lifecycle_entry("demo", "unknown")
            self.assertFalse(log_path.exists())


if __name__ == "__main__":
    unittest.main()
