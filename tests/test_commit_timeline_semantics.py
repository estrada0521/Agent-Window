from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from workspace_sync.commit import adopt_commit_baseline, ensure_commit_announcements


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
    def __init__(self, workspace: Path) -> None:
        self.workspace = str(workspace)
        self.announced: list[dict] = []

    def append_system_entry(self, message: str, *, kind: str = "", **extra) -> dict:
        entry = {"message": message, "kind": kind, **extra}
        self.announced.append(entry)
        return entry


class CommitTimelineSemanticsTests(unittest.TestCase):
    """The timeline projects the commit HEAD moved to while this process was
    watching -- that one, once. No `last..HEAD` range replay, so commits made
    while the process was down are absorbed as the baseline, not back-filled.

    It also does NOT run `git merge-base --is-ancestor` (or any equivalent) to
    tell a fast-forward apart from a diverged branch switch: deciding what
    counts as a "real" advance is ownership over the user's git history this
    project doesn't take. Don't "fix" either of these by adding a range walk
    or a fast-forward guard.
    """

    def _repo(self, tmp: str) -> tuple[Path, _FakeRuntime]:
        workspace = Path(tmp) / "repo"
        workspace.mkdir()
        _git(workspace, "init", "-q")
        _git(workspace, "config", "user.email", "test@example.com")
        _git(workspace, "config", "user.name", "Test")
        return workspace, _FakeRuntime(workspace)

    def test_startup_absorbs_head_without_announcing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace, runtime = self._repo(tmp)
            _commit(workspace, "base.txt", "base")
            _commit(workspace, "more.txt", "more")

            adopt_commit_baseline(runtime)
            self.assertEqual(runtime.announced, [])

            # A refire with HEAD unchanged stays silent too.
            ensure_commit_announcements(runtime)
            self.assertEqual(runtime.announced, [])

    def test_observed_advance_announces_only_the_new_head(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace, runtime = self._repo(tmp)
            _commit(workspace, "base.txt", "base")
            adopt_commit_baseline(runtime)

            _commit(workspace, "a.txt", "a")
            _commit(workspace, "b.txt", "b")
            head = _head(workspace)

            ensure_commit_announcements(runtime)
            self.assertEqual(len(runtime.announced), 1)
            self.assertEqual(runtime.announced[0]["commit_hash"], head)

    def test_diverged_branch_switch_is_announced_like_any_advance(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace, runtime = self._repo(tmp)
            _commit(workspace, "base.txt", "base")
            base_hash = _head(workspace)
            _commit(workspace, "main-only.txt", "on-main")
            main_hash = _head(workspace)

            adopt_commit_baseline(runtime)
            ensure_commit_announcements(runtime)
            self.assertEqual(runtime.announced, [])

            _git(workspace, "checkout", "-q", "-b", "other", base_hash)
            _commit(workspace, "other-only.txt", "on-other")
            other_hash = _head(workspace)
            self.assertNotEqual(other_hash, main_hash)

            ensure_commit_announcements(runtime)
            self.assertEqual(len(runtime.announced), 1)
            self.assertEqual(runtime.announced[0]["commit_hash"], other_hash)


if __name__ == "__main__":
    unittest.main()
