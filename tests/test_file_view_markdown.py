from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from workspace_sync.files.runtime import FileRuntime


class MarkdownFileViewTests(unittest.TestCase):
    def test_markdown_preview_embeds_file_content(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            (workspace / "notes.md").write_text("# Hello\n\nworld\n", encoding="utf-8")
            # repo_root mirrors the real chat-server construction path
            # (server/server.py), which is what mobile's file viewer hits.
            runtime = FileRuntime(workspace=workspace, repo_root=workspace)

            html = runtime.file_view("notes.md", embed=True)

            self.assertIn('class="md-preview-shell"', html)
            self.assertIn('id="out"', html)
            self.assertIn(f"const __mdText = {json.dumps('# Hello\n\nworld\n')}", html)


if __name__ == "__main__":
    unittest.main()
