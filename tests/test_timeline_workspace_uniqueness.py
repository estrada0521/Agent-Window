from __future__ import annotations

import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fs.log.meta import find_label_for_workspace
from server.hub.new_timeline import post_start_timeline_draft


class FindTimelineForWorkspaceTests(unittest.TestCase):
    @staticmethod
    def _write_meta(root: Path, timeline: str, workspace: str) -> None:
        log_dir = root / timeline
        log_dir.mkdir(parents=True, exist_ok=True)
        (log_dir / ".meta").write_text(
            json.dumps({"timeline": timeline, "workspace": workspace}), encoding="utf-8"
        )

    def test_finds_the_timeline_recorded_for_a_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "log"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            self._write_meta(root, "my-timeline", str(workspace.resolve()))

            with mock.patch(
                "fs.log.paths.agent_window_root", return_value=Path(tmp)
            ):
                found = find_label_for_workspace(workspace)

            self.assertEqual(found, "my-timeline")

    def test_finds_an_archived_timeline_with_no_active_tmux_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "log"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            self._write_meta(root, "archived-timeline", str(workspace.resolve()))

            with mock.patch(
                "fs.log.paths.agent_window_root", return_value=Path(tmp)
            ):
                found = find_label_for_workspace(workspace)

            self.assertEqual(found, "archived-timeline")

    def test_excludes_the_named_timeline_for_the_revive_flow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "log"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            self._write_meta(root, "my-timeline", str(workspace.resolve()))

            with mock.patch(
                "fs.log.paths.agent_window_root", return_value=Path(tmp)
            ):
                found = find_label_for_workspace(workspace, exclude_label="my-timeline")

            self.assertIsNone(found)

    def test_no_match_for_a_different_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "log"
            workspace = Path(tmp) / "workspace"
            other_workspace = Path(tmp) / "other-workspace"
            workspace.mkdir()
            other_workspace.mkdir()
            self._write_meta(root, "my-timeline", str(workspace.resolve()))

            with mock.patch(
                "fs.log.paths.agent_window_root", return_value=Path(tmp)
            ):
                found = find_label_for_workspace(other_workspace)

            self.assertIsNone(found)

    def test_no_match_when_the_log_root_does_not_exist_yet(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "log"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()

            with mock.patch(
                "fs.log.paths.agent_window_root", return_value=Path(tmp)
            ):
                found = find_label_for_workspace(workspace)

            self.assertIsNone(found)

    @staticmethod
    def _draft_handler(workspace: Path):
        body = json.dumps({"workspace": str(workspace)}).encode("utf-8")
        handler = mock.Mock()
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = io.BytesIO(body)
        return handler

    def test_workspace_claim_is_rejected_before_timeline_label_allocation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "Agent-Window"
            workspace.mkdir()
            handler = self._draft_handler(workspace)
            timeline_api = mock.Mock()

            with (
                mock.patch(
                    "server.hub.new_timeline.find_label_for_workspace",
                    return_value="existing-timeline",
                ),
                mock.patch("server.hub.new_timeline.log_dir") as log_dir,
            ):
                post_start_timeline_draft(handler, None, {"timeline_api": timeline_api})

            handler._send_json.assert_called_once_with(
                409,
                {"ok": False, "error": "A timeline already exists for this workspace: existing-timeline"},
            )
            log_dir.assert_not_called()

    def test_duplicate_workspace_basename_gets_an_opaque_timeline_label(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "new-parent" / "Agent-Window"
            workspace.mkdir(parents=True)
            log_root = Path(tmp) / "log"
            (log_root / "Agent-Window").mkdir(parents=True)
            digest = hashlib.sha256(str(workspace.resolve()).encode("utf-8")).hexdigest()
            (log_root / f"aw-{digest[:8]}").mkdir()
            expected_name = f"aw-{digest[:12]}"
            handler = self._draft_handler(workspace)
            hub = mock.Mock(repo_root=Path(tmp))

            with (
                mock.patch(
                    "server.hub.new_timeline.find_label_for_workspace",
                    return_value=None,
                ),
                mock.patch(
                    "server.hub.new_timeline.log_dir",
                    side_effect=lambda name: log_root / name,
                ),
                mock.patch("server.hub.new_timeline.open_room") as open_room,
                mock.patch("server.hub.new_timeline.workspace_room_port", return_value=41000),
                mock.patch("server.hub.new_timeline.port_is_bindable", return_value=True),
                mock.patch(
                    "server.hub.new_timeline.ensure_room_server",
                    return_value=(True, 41000, ""),
                ),
            ):
                post_start_timeline_draft(
                    handler,
                    None,
                    {
                        "hub": hub,
                        "format_room_url_fn": (
                            lambda port, _path: f"/{port}/"
                        ),
                    },
                )

            handler._send_json.assert_called_once()
            status, payload = handler._send_json.call_args.args
            self.assertEqual(status, 200)
            self.assertEqual(
                {k: v for k, v in payload.items() if k != "notice"},
                {
                    "ok": True,
                    "timeline": expected_name,
                    "room_url": "/41000/",
                },
            )
            self.assertIn(expected_name, payload["notice"])
            open_room.assert_called_once_with(
                timeline_label=expected_name,
                workspace=str(workspace.resolve()),
                agents=[],
            )


if __name__ == "__main__":
    unittest.main()
