from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from workspace_sync.commit import ensure_commit_announcements


def _git(workspace: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(workspace), *args], check=True, capture_output=True, text=True)


def _commit(workspace: Path, name: str, message: str) -> None:
    (workspace / name).write_text(message, encoding="utf-8")
    _git(workspace, "add", name)
    _git(workspace, "commit", "-m", message)


def _head(workspace: Path) -> str:
    result = subprocess.run(
        ["git", "-C", str(workspace), "rev-parse", "HEAD"],
        check=True, capture_output=True, text=True,
    )
    return result.stdout.strip()


class _FakeRuntime:
    def __init__(self, workspace: Path, session_dir: Path) -> None:
        self.workspace = str(workspace)
        self.log_path = session_dir / "session.log.jsonl"
        self.announced: list[dict] = []

    def append_system_entry(self, message: str, *, kind: str = "", **extra) -> dict:
        entry = {"message": message, "kind": kind, **extra}
        self.announced.append(entry)
        return entry


class NonFastForwardTimelineIsNotDetectedTests(unittest.TestCase):
    """`ensure_commit_announcements()` reconciles the commit timeline with a
    plain `last_hash..HEAD` git-log range and nothing more. It intentionally
    does NOT run `git merge-base --is-ancestor` (or any equivalent check) to
    tell a fast-forward advance apart from a diverged branch switch or a
    reset to unrelated history.

    This is a conscious simplicity tradeoff, not a gap: adding ancestor
    detection would turn this module into an opinionated arbiter of git
    history semantics (what counts as a "real" advance vs. a "rewrite"),
    which is exactly the kind of ownership over the user's git state this
    project avoids taking. Do not "fix" this by adding a fast-forward guard
    -- that would be re-introducing scope this project deliberately doesn't
    want. If this test starts failing, the fix is almost certainly wrong.
    """

    def test_diverged_branch_switch_is_announced_like_a_fast_forward(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "repo"
            workspace.mkdir()
            session_dir = Path(tmp) / "session"
            session_dir.mkdir()

            _git(workspace, "init", "-q")
            _git(workspace, "config", "user.email", "test@example.com")
            _git(workspace, "config", "user.name", "Test")
            _commit(workspace, "base.txt", "base")
            base_hash = _head(workspace)

            _commit(workspace, "main-only.txt", "on-main")
            main_hash = _head(workspace)

            runtime = _FakeRuntime(workspace, session_dir)
            ensure_commit_announcements(runtime)
            self.assertEqual(len(runtime.announced), 1)
            self.assertEqual(runtime.announced[0]["commit_hash"], main_hash)

            # Diverge: branch off the pre-main-only base, not off main_hash.
            _git(workspace, "checkout", "-q", "-b", "other", base_hash)
            _commit(workspace, "other-only.txt", "on-other")
            other_hash = _head(workspace)
            self.assertNotEqual(other_hash, main_hash)

            # `other_hash` is NOT a descendant of `main_hash` -- this is a
            # non-fast-forward transition. The mechanism announces it anyway,
            # with no ancestor check and no error.
            runtime.announced.clear()
            ensure_commit_announcements(runtime)

            self.assertEqual(len(runtime.announced), 1)
            self.assertEqual(runtime.announced[0]["commit_hash"], other_hash)


if __name__ == "__main__":
    unittest.main()
