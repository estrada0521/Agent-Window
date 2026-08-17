from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from workspace_sync.files.runtime import FileRuntime


class FileRuntimeListTests(unittest.TestCase):
    def test_list_dir_reads_only_the_requested_folder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            (workspace / "apps").mkdir()
            (workspace / "apps" / "test.md").write_text("hi\n", encoding="utf-8")
            (workspace / "scratch").mkdir()
            (workspace / "scratch" / "blob.bin").write_bytes(b"x" * 1024)
            runtime = FileRuntime(workspace=workspace, repo_root=workspace)

            root_entries = runtime.list_dir("")
            names = {entry["name"] for entry in root_entries}
            self.assertIn("apps", names)
            self.assertNotIn("test.md", names)

            app_entries = runtime.list_dir("apps")
            self.assertEqual([entry["name"] for entry in app_entries], ["test.md"])
            self.assertEqual(app_entries[0]["kind"], "file")

    def test_search_files_uses_git_visible_paths_not_ignored_dumps(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True)
            (workspace / ".gitignore").write_text("scratch/\n", encoding="utf-8")
            (workspace / "apps").mkdir()
            (workspace / "apps" / "test.md").write_text("hi\n", encoding="utf-8")
            (workspace / "scratch").mkdir()
            (workspace / "scratch" / "blob.bin").write_bytes(b"x" * 1024)
            runtime = FileRuntime(workspace=workspace, repo_root=workspace)

            hits = runtime.search_files("test.md", limit=20)
            paths = [entry["path"] for entry in hits]
            self.assertIn("apps/test.md", paths)
            self.assertNotIn("scratch/blob.bin", paths)
