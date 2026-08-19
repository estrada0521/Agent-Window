from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend_core.access.session_meta import find_session_for_workspace


class FindSessionForWorkspaceTests(unittest.TestCase):
    @staticmethod
    def _write_meta(root: Path, session: str, workspace: str) -> None:
        session_dir = root / session
        session_dir.mkdir(parents=True, exist_ok=True)
        (session_dir / ".meta").write_text(
            json.dumps({"session": session, "workspace": workspace}), encoding="utf-8"
        )

    def test_finds_the_session_recorded_for_a_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "session-root"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            self._write_meta(root, "my-session", str(workspace.resolve()))

            with mock.patch(
                "backend_core.access.session_meta.agent_window_session_root", return_value=root
            ):
                found = find_session_for_workspace(workspace)

            self.assertEqual(found, "my-session")

    def test_finds_an_archived_session_with_no_active_tmux_state(self) -> None:
        # A session's .meta persists after its tmux session is killed --
        # find_session_for_workspace has no tmux dependency at all, so
        # archived sessions are found the same way as active ones.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "session-root"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            self._write_meta(root, "archived-session", str(workspace.resolve()))

            with mock.patch(
                "backend_core.access.session_meta.agent_window_session_root", return_value=root
            ):
                found = find_session_for_workspace(workspace)

            self.assertEqual(found, "archived-session")

    def test_excludes_the_named_session_for_the_revive_flow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "session-root"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            self._write_meta(root, "my-session", str(workspace.resolve()))

            with mock.patch(
                "backend_core.access.session_meta.agent_window_session_root", return_value=root
            ):
                found = find_session_for_workspace(workspace, exclude_session="my-session")

            self.assertIsNone(found)

    def test_no_match_for_a_different_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "session-root"
            workspace = Path(tmp) / "workspace"
            other_workspace = Path(tmp) / "other-workspace"
            workspace.mkdir()
            other_workspace.mkdir()
            self._write_meta(root, "my-session", str(workspace.resolve()))

            with mock.patch(
                "backend_core.access.session_meta.agent_window_session_root", return_value=root
            ):
                found = find_session_for_workspace(other_workspace)

            self.assertIsNone(found)

    def test_no_match_when_the_session_root_does_not_exist_yet(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "does-not-exist"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()

            with mock.patch(
                "backend_core.access.session_meta.agent_window_session_root", return_value=root
            ):
                found = find_session_for_workspace(workspace)

            self.assertIsNone(found)


if __name__ == "__main__":
    unittest.main()
