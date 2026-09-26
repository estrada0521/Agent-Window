from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fs.files.runtime import FileRuntime


class ReferencePathBypassIsIntentionalTests(unittest.TestCase):

    def test_absolute_path_outside_workspace_resolves(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            workspace = tmp_path / "workspace"
            workspace.mkdir()
            outside = tmp_path / "outside"
            outside.mkdir()
            target = outside / "secret.txt"
            target.write_text("outside content\n", encoding="utf-8")

            runtime = FileRuntime(workspace=workspace)
            resolved = runtime._resolve_path(str(target))
            self.assertEqual(resolved, str(target.resolve()))

    def test_home_relative_reference_outside_workspace_resolves(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            runtime = FileRuntime(workspace=workspace)

            resolved = runtime._resolve_path("~/.bashrc")
            self.assertEqual(resolved, str(Path("~/.bashrc").expanduser().resolve()))

    def test_workspace_relative_reference_resolves_inside_the_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            (workspace / "in-workspace.txt").write_text("hi\n", encoding="utf-8")
            runtime = FileRuntime(workspace=workspace)

            resolved = runtime._resolve_path("in-workspace.txt")
            self.assertEqual(resolved, str((workspace / "in-workspace.txt").resolve()))


if __name__ == "__main__":
    unittest.main()
