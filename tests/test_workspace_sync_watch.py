from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fs.watch import _DebouncedWorkspaceRefresh, _is_git_head_metadata_path


class _FakeRuntime:
    def __init__(self) -> None:
        self.commit_refreshes = 0
        self.events: list[str] = []

    def publish_event(self, kind: str) -> None:
        self.events.append(kind)

    def report_failure(self, text: str) -> None:
        raise AssertionError(text)

    def observe_commits(self) -> None:
        self.commit_refreshes += 1


class _FakeWorkspaceFiles:
    def __init__(self, workspace: Path) -> None:
        self.workspace = str(workspace.resolve())

    @staticmethod
    def file_index_path_is_ignored(_rel: str) -> bool:
        return False


class _FakeApi:
    def __init__(self, workspace: Path) -> None:
        self.files = _FakeWorkspaceFiles(workspace)
        self.state = _FakeRuntime()


def _refresh(api: _FakeApi) -> _DebouncedWorkspaceRefresh:
    return _DebouncedWorkspaceRefresh(
        api.files,
        publish_event=api.state.publish_event,
        report_failure=api.state.report_failure,
        on_head_changed=api.state.observe_commits,
    )


class WorkspaceSyncWatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.commit_cache_clears = 0

        def clear() -> None:
            self.commit_cache_clears += 1

        git_patcher = mock.patch("fs.watch.clear_commit_list_cache", side_effect=clear)
        git_patcher.start()
        self.addCleanup(git_patcher.stop)

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

    def test_git_ref_event_refreshes_commits(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            api = _FakeApi(workspace)
            refresh = _refresh(api)

            with mock.patch("fs.watch.threading.Timer") as timer_class:
                refresh.add_path(str(workspace / ".git" / "refs" / "heads" / "main"))
                self.assertEqual(timer_class.call_count, 1)
            refresh._flush_locked()

            self.assertEqual(api.state.commit_refreshes, 1)
            self.assertEqual(self.commit_cache_clears, 1)
            self.assertEqual(api.state.events, ["git"])

    def test_regular_file_event_publishes_files_and_git(self) -> None:
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

            self.assertEqual(api.state.commit_refreshes, 0)
            self.assertEqual(self.commit_cache_clears, 0)
            self.assertEqual(api.state.events, ["files", "git"])

    def test_git_object_event_is_ignored_entirely(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            api = _FakeApi(workspace)
            refresh = _refresh(api)

            with mock.patch("fs.watch.threading.Timer") as timer_class:
                refresh.add_path(str(workspace / ".git" / "objects" / "pack" / "large.pack"))
                self.assertEqual(timer_class.call_count, 0)
            refresh._flush_locked()

            self.assertEqual(api.state.commit_refreshes, 0)
            self.assertEqual(self.commit_cache_clears, 0)
            self.assertEqual(api.state.events, [])

    def test_gitignored_file_publishes_only_files(self) -> None:
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

            self.assertEqual(api.state.events, ["files"])

            with mock.patch("fs.watch.threading.Timer"):
                refresh.add_path(str(tracked))
            refresh._flush_locked()

            self.assertEqual(api.state.events, ["files", "files", "git"])


if __name__ == "__main__":
    unittest.main()
