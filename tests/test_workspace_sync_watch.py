from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from workspace_sync.api import WorkspaceSyncApi
from workspace_sync.watch import _DebouncedWorkspaceRefresh, _is_git_head_metadata_path


class _FakeRuntime:
    def __init__(self) -> None:
        self.commit_refreshes = 0

    def ensure_commit_announcements(self) -> None:
        self.commit_refreshes += 1


class _FakeFileRuntime:
    def __init__(self, workspace: Path) -> None:
        self.workspace = str(workspace.resolve())

    @staticmethod
    def file_index_path_is_ignored(_rel: str) -> bool:
        return False


class _FakeApi:
    def __init__(self, workspace: Path) -> None:
        self.file_runtime = _FakeFileRuntime(workspace)
        self.runtime = _FakeRuntime()
        self.file_invalidations = 0
        self.git_invalidations = 0
        self.sync_events = 0

    def invalidate_file_index_cache(self) -> None:
        self.file_invalidations += 1

    def invalidate_git_cache(self) -> None:
        self.git_invalidations += 1

    def publish_sync_event(self) -> None:
        self.sync_events += 1


class WorkspaceSyncWatchTests(unittest.TestCase):
    def test_workspace_api_startup_does_not_eagerly_scan_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            file_runtime = mock.Mock()
            with (
                mock.patch("workspace_sync.api.FileRuntime", return_value=file_runtime),
                mock.patch("workspace_sync.api.workspace_git.configure"),
                mock.patch("workspace_sync.api.start_workspace_fsevents_watcher"),
            ):
                WorkspaceSyncApi(
                    workspace=workspace,
                    repo_root=workspace,
                    runtime=mock.Mock(),
                )

            file_runtime.refresh_file_list_cache.assert_not_called()

    def test_git_head_metadata_filter_excludes_large_git_payloads(self) -> None:
        for rel in (
            ".git",
            ".git/HEAD",
            ".git/packed-refs",
            ".git/refs/heads/main",
            ".git/logs/HEAD",
            ".git/logs/refs/heads/main",
            ".git/worktrees/topic/HEAD",
            ".git/reftable/tables.list",
        ):
            with self.subTest(rel=rel):
                self.assertTrue(_is_git_head_metadata_path(rel))

        for rel in (
            ".git/COMMIT_EDITMSG",
            ".git/index",
            ".git/objects/12/345678",
            ".git/objects/pack/large.pack",
        ):
            with self.subTest(rel=rel):
                self.assertFalse(_is_git_head_metadata_path(rel))

    def test_git_ref_event_refreshes_commits_without_file_index_scan(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            api = _FakeApi(workspace)
            refresh = _DebouncedWorkspaceRefresh(api)

            with mock.patch("workspace_sync.watch.threading.Timer") as timer_class:
                refresh.add_path(str(workspace / ".git" / "refs" / "heads" / "main"))
                self.assertEqual(timer_class.call_count, 1)
            refresh._flush_locked()

            self.assertEqual(api.runtime.commit_refreshes, 1)
            self.assertEqual(api.file_invalidations, 0)
            self.assertEqual(api.git_invalidations, 1)
            self.assertEqual(api.sync_events, 1)

    def test_regular_file_event_only_invalidates_lazy_file_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True)
            src = workspace / "src"
            src.mkdir()
            (src / "app.py").write_text("print(1)\n", encoding="utf-8")
            api = _FakeApi(workspace)
            refresh = _DebouncedWorkspaceRefresh(api)

            with mock.patch("workspace_sync.watch.threading.Timer"):
                refresh.add_path(str(src / "app.py"))
            refresh._flush_locked()

            self.assertEqual(api.runtime.commit_refreshes, 0)
            self.assertEqual(api.file_invalidations, 1)
            self.assertEqual(api.git_invalidations, 1)
            self.assertEqual(api.sync_events, 1)

    def test_git_object_event_is_ignored_entirely(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            api = _FakeApi(workspace)
            refresh = _DebouncedWorkspaceRefresh(api)

            with mock.patch("workspace_sync.watch.threading.Timer") as timer_class:
                refresh.add_path(str(workspace / ".git" / "objects" / "pack" / "large.pack"))
                self.assertEqual(timer_class.call_count, 0)
            refresh._flush_locked()

            self.assertEqual(api.runtime.commit_refreshes, 0)
            self.assertEqual(api.file_invalidations, 0)
            self.assertEqual(api.git_invalidations, 0)
            self.assertEqual(api.sync_events, 0)

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
            refresh = _DebouncedWorkspaceRefresh(api)

            with mock.patch("workspace_sync.watch.threading.Timer"):
                refresh.add_path(str(ignored))
            refresh._flush_locked()

            self.assertEqual(api.file_invalidations, 1)
            self.assertEqual(api.git_invalidations, 0)
            self.assertEqual(api.sync_events, 1)

            with mock.patch("workspace_sync.watch.threading.Timer"):
                refresh.add_path(str(tracked))
            refresh._flush_locked()

            self.assertEqual(api.file_invalidations, 2)
            self.assertEqual(api.git_invalidations, 1)
            self.assertEqual(api.sync_events, 2)


if __name__ == "__main__":
    unittest.main()
