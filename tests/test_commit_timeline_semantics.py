from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from git.commit import CommitAnnouncer


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


class CommitTimelineSemanticsTests(unittest.TestCase):

    def _repo(self, tmp: str) -> tuple[Path, CommitAnnouncer, list[dict]]:
        workspace = Path(tmp) / "repo"
        workspace.mkdir()
        _git(workspace, "init", "-q")
        _git(workspace, "config", "user.email", "test@example.com")
        _git(workspace, "config", "user.name", "Test")
        announced: list[dict] = []
        return workspace, CommitAnnouncer(str(workspace), announced.append), announced

    def test_startup_absorbs_head_without_announcing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace, commits, announced = self._repo(tmp)
            _commit(workspace, "base.txt", "base")
            _commit(workspace, "more.txt", "more")

            commits.adopt_baseline()
            self.assertEqual(announced, [])

            commits.observe()
            self.assertEqual(announced, [])

    def test_observed_commits_are_announced_in_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace, commits, announced = self._repo(tmp)
            _commit(workspace, "base.txt", "base")
            commits.adopt_baseline()

            _commit(workspace, "a.txt", "a")
            _commit(workspace, "b.txt", "b")
            head = _head(workspace)

            commits.observe()
            self.assertEqual([entry["message"] for entry in announced], ["commit: a", "commit: b"])
            self.assertEqual(announced[-1]["hash"], head)

    def test_diverged_branch_switch_and_commit_are_both_announced(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace, commits, announced = self._repo(tmp)
            _commit(workspace, "base.txt", "base")
            base_hash = _head(workspace)
            _commit(workspace, "main-only.txt", "on-main")
            main_hash = _head(workspace)

            commits.adopt_baseline()
            commits.observe()
            self.assertEqual(announced, [])

            _git(workspace, "checkout", "-q", "-b", "other", base_hash)
            _commit(workspace, "other-only.txt", "on-other")
            other_hash = _head(workspace)
            self.assertNotEqual(other_hash, main_hash)

            commits.observe()
            self.assertEqual(len(announced), 2)
            self.assertEqual(announced[0]["hash"], base_hash)
            self.assertTrue(announced[0]["message"].startswith("checkout: "))
            self.assertEqual(announced[1]["hash"], other_hash)


if __name__ == "__main__":
    unittest.main()
