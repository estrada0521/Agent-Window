from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from workspace_sync.files.runtime import FileRuntime


class FileOpeningTests(unittest.TestCase):
    def test_any_file_type_opens_with_system_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            archive = workspace / "example.zip"
            archive.write_bytes(b"not a real archive")
            runtime = FileRuntime(workspace=workspace)
            completed = mock.Mock(returncode=0)

            with (
                mock.patch("workspace_sync.files.runtime.subprocess.run", return_value=completed) as run,
                mock.patch("workspace_sync.files.runtime.subprocess.Popen") as popen,
            ):
                result = runtime.open_with_default_app("example.zip")

            run.assert_called_once_with(
                ["open", str(archive.resolve())],
                stdout=mock.ANY,
                stderr=mock.ANY,
                timeout=10,
                check=False,
            )
            popen.assert_not_called()
            self.assertFalse(result["revealed_in_finder"])

    def test_failed_default_open_reveals_file_in_finder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            target = workspace / "unknown.data"
            target.write_bytes(b"\x00\x01")
            runtime = FileRuntime(workspace=workspace)
            completed = mock.Mock(returncode=1)

            with (
                mock.patch("workspace_sync.files.runtime.subprocess.run", return_value=completed),
                mock.patch("workspace_sync.files.runtime.subprocess.Popen") as popen,
            ):
                result = runtime.open_with_default_app("unknown.data")

            popen.assert_called_once_with(
                ["open", "-R", str(target.resolve())],
                stdout=mock.ANY,
                stderr=mock.ANY,
                start_new_session=True,
            )
            self.assertTrue(result["revealed_in_finder"])


if __name__ == "__main__":
    unittest.main()
