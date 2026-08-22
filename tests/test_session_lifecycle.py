import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend_core.tmux.control import SessionControlError, append_session_lifecycle_entry


class SessionLifecycleEntryTests(unittest.TestCase):
    def test_appends_archived_and_revived_system_entries(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / ".log.jsonl"
            with patch("backend_core.tmux.control.session_log_path", return_value=log_path):
                append_session_lifecycle_entry("demo", "archived")
                append_session_lifecycle_entry("demo", "revived")

            entries = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
            self.assertTrue(all(entry["message"] for entry in entries))
            self.assertEqual([entry["lifecycle_action"] for entry in entries], ["archived", "revived"])
            self.assertTrue(all(entry["sender"] == "system" for entry in entries))
            self.assertTrue(all(entry["kind"] == "session-lifecycle" for entry in entries))

    def test_unknown_action_raises_instead_of_silently_dropping(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / ".log.jsonl"
            with patch("backend_core.tmux.control.session_log_path", return_value=log_path):
                with self.assertRaises(SessionControlError):
                    append_session_lifecycle_entry("demo", "unknown")
            self.assertFalse(log_path.exists())


if __name__ == "__main__":
    unittest.main()
