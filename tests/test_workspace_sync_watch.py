from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fs.files.runtime import FileRuntime
from fs.watch import _DebouncedWorkspaceRefresh, _is_git_head_metadata_path


class _FakeRuntime:
    def __init__(self) -> None:
        self.commit_refreshes = 0
        self.events: list[str] = []

    def publish_event(self, kind: str) -> None:
        self.events.append(kind)

    def ensure_commit_announcements(self) -> None:
        self.commit_refreshes += 1


class _FakeFileRuntime:
    def __init__(self, workspace: Path) -> None:
        self.workspace = str(workspace.resolve())
        self.invalidations = 0

    @staticmethod
    def file_index_path_is_ignored(_rel: str) -> bool:
        return False

    def invalidate_file_list_cache(self) -> None:
        self.invalidations += 1


class _FakeApi:
    def __init__(self, workspace: Path) -> None:
        self.file_runtime = _FakeFileRuntime(workspace)
        self.runtime = _FakeRuntime()

    @property
    def file_invalidations(self) -> int:
        return self.file_runtime.invalidations


def _refresh(api: _FakeApi) -> _DebouncedWorkspaceRefresh:
    return _DebouncedWorkspaceRefresh(api.runtime, api.file_runtime)


class WorkspaceSyncWatchTests(unittest.TestCase):
    def setUp(self) -> None:
        patcher = mock.patch(
            "fs.watch.ensure_commit_announcements",
            side_effect=lambda runtime: runtime.ensure_commit_announcements(),
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.git_invalidations: list[bool] = []
        git_patcher = mock.patch(
            "fs.watch.invalidate_git_cache",
            side_effect=lambda *, include_commits: self.git_invalidations.append(include_commits),
        )
        git_patcher.start()
        self.addCleanup(git_patcher.stop)

    def test_file_runtime_startup_does_not_eagerly_scan_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(FileRuntime, "refresh_file_list_cache") as refresh:
                FileRuntime(workspace=Path(tmp))
            refresh.assert_not_called()

    def test_git_head_metadata_filter_excludes_large_git_payloads(self) -> None:
        for rel in (
            ".git",
            ".git/HEAD",
            ".git/packed-refs",
            ".git/refs/heads/main",
            ".git/logs/HEAD",
            ".git/logs/refs/heads/main",
            ".git/reftable/tables.list",
        ):
            with self.subTest(rel=rel):
                self.assertTrue(_is_git_head_metadata_path(rel))

        for rel in (
            ".git/COMMIT_EDITMSG",
            ".git/index",
            ".git/objects/12/345678",
            ".git/objects/pack/large.pack",
            ".git/worktrees/topic/HEAD",
        ):
            with self.subTest(rel=rel):
                self.assertFalse(_is_git_head_metadata_path(rel))

    def test_git_ref_event_refreshes_commits_without_file_index_scan(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            api = _FakeApi(workspace)
            refresh = _refresh(api)

            with mock.patch("fs.watch.threading.Timer") as timer_class:
                refresh.add_path(str(workspace / ".git" / "refs" / "heads" / "main"))
                self.assertEqual(timer_class.call_count, 1)
            refresh._flush_locked()

            self.assertEqual(api.runtime.commit_refreshes, 1)
            self.assertEqual(api.file_invalidations, 0)
            self.assertEqual(len(self.git_invalidations), 1)
            self.assertEqual(api.runtime.events, ["git"])

    def test_regular_file_event_only_invalidates_lazy_file_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True)
            src = workspace / "src"
            src.mkdir()
            (src / "app.py").write_text("print(1)\n", encoding="utf-8")
            api = _FakeApi(workspace)
            refresh = _refresh(api)

            with mock.patch("fs.watch.threading.Timer"):
                refresh.add_path(str(src / "app.py"))
            refresh._flush_locked()

            self.assertEqual(api.runtime.commit_refreshes, 0)
            self.assertEqual(api.file_invalidations, 1)
            self.assertEqual(len(self.git_invalidations), 1)
            self.assertEqual(api.runtime.events, ["files", "git"])

    def test_git_object_event_is_ignored_entirely(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            api = _FakeApi(workspace)
            refresh = _refresh(api)

            with mock.patch("fs.watch.threading.Timer") as timer_class:
                refresh.add_path(str(workspace / ".git" / "objects" / "pack" / "large.pack"))
                self.assertEqual(timer_class.call_count, 0)
            refresh._flush_locked()

            self.assertEqual(api.runtime.commit_refreshes, 0)
            self.assertEqual(api.file_invalidations, 0)
            self.assertEqual(len(self.git_invalidations), 0)
            self.assertEqual(api.runtime.events, [])

    def test_gitignored_file_does_not_invalidate_git_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True)
            (workspace / ".gitignore").write_text("scratch/\n", encoding="utf-8")
            scratch = workspace / "scratch"
            scratch.mkdir()
            ignored = scratch / "out.bin"
            ignored.write_bytes(b"x")
            tracked = workspace / "app.py"
            tracked.write_text("print(1)\n", encoding="utf-8")
            api = _FakeApi(workspace)
            refresh = _refresh(api)

            with mock.patch("fs.watch.threading.Timer"):
                refresh.add_path(str(ignored))
            refresh._flush_locked()

            self.assertEqual(api.file_invalidations, 1)
            self.assertEqual(len(self.git_invalidations), 0)
            self.assertEqual(api.runtime.events, ["files"])

            with mock.patch("fs.watch.threading.Timer"):
                refresh.add_path(str(tracked))
            refresh._flush_locked()

            self.assertEqual(api.file_invalidations, 2)
            self.assertEqual(len(self.git_invalidations), 1)
            self.assertEqual(api.runtime.events, ["files", "files", "git"])


if __name__ == "__main__":
    unittest.main()
