from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from workspace_sync.files.runtime import FileRuntime


class ReferencePathBypassIsIntentionalTests(unittest.TestCase):
    """`_resolve_reference_path()` deliberately does NOT confine absolute or
    `~`-prefixed references to workspace/allowed_roots the way `_resolve_path()`
    does. This is a conscious design decision, not an oversight: the LAN this
    app binds to is already the trust boundary (an agent in this session has
    full shell access to the whole machine regardless), and adding
    containment here would just break the common case of referencing files
    outside the workspace while providing no real security benefit. Do not
    "fix" this by routing it through `_resolve_path()` -- that would silently
    break intentional cross-root file references. If this test starts
    failing, the fix is almost certainly wrong.
    """

    def test_absolute_path_outside_workspace_and_allowed_roots_resolves(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            workspace = tmp_path / "workspace"
            workspace.mkdir()
            outside = tmp_path / "outside"
            outside.mkdir()
            target = outside / "secret.txt"
            target.write_text("outside content\n", encoding="utf-8")

            runtime = FileRuntime(workspace=workspace, repo_root=workspace)
            self.assertFalse(runtime._is_allowed_path(str(target)))

            resolved = runtime._resolve_reference_path(str(target))
            self.assertEqual(resolved, str(target.resolve()))

    def test_home_relative_reference_outside_workspace_resolves(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            runtime = FileRuntime(workspace=workspace, repo_root=workspace)

            resolved = runtime._resolve_reference_path("~/.bashrc")
            self.assertEqual(resolved, str(Path("~/.bashrc").expanduser().resolve()))
            self.assertFalse(runtime._is_allowed_path(resolved))

    def test_workspace_relative_reference_still_stays_contained(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            (workspace / "in-workspace.txt").write_text("hi\n", encoding="utf-8")
            runtime = FileRuntime(workspace=workspace, repo_root=workspace)

            resolved = runtime._resolve_reference_path("in-workspace.txt")
            self.assertEqual(resolved, str((workspace / "in-workspace.txt").resolve()))

            with self.assertRaises(PermissionError):
                runtime._resolve_reference_path("../escape.txt")


if __name__ == "__main__":
    unittest.main()
