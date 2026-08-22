from __future__ import annotations

import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend_core.access.session_meta import SessionMetaError, WorkspaceClaimConflict, find_session_for_workspace
from hub_backend.new_session.handlers import post_start_session_draft
from hub_backend.session_query import collect_repo_sessions


class FindSessionForWorkspaceTests(unittest.TestCase):
    @staticmethod
    def _write_meta(root: Path, session: str, workspace: str) -> None:
        session_dir = root / session
        session_dir.mkdir(parents=True, exist_ok=True)
        (session_dir / ".meta").write_text(
            json.dumps({"session": session, "workspace": workspace}), encoding="utf-8"
        )

    def test_finds_the_session_recorded_for_a_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "session-root"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            self._write_meta(root, "my-session", str(workspace.resolve()))

            with mock.patch(
                "backend_core.access.session_meta.agent_window_session_root", return_value=root
            ):
                found = find_session_for_workspace(workspace)

            self.assertEqual(found, "my-session")

    def test_finds_an_archived_session_with_no_active_tmux_state(self) -> None:
        # A session's .meta persists after its tmux session is killed --
        # find_session_for_workspace has no tmux dependency at all, so
        # archived sessions are found the same way as active ones.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "session-root"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            self._write_meta(root, "archived-session", str(workspace.resolve()))

            with mock.patch(
                "backend_core.access.session_meta.agent_window_session_root", return_value=root
            ):
                found = find_session_for_workspace(workspace)

            self.assertEqual(found, "archived-session")

    def test_excludes_the_named_session_for_the_revive_flow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "session-root"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            self._write_meta(root, "my-session", str(workspace.resolve()))

            with mock.patch(
                "backend_core.access.session_meta.agent_window_session_root", return_value=root
            ):
                found = find_session_for_workspace(workspace, exclude_session="my-session")

            self.assertIsNone(found)

    def test_no_match_for_a_different_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "session-root"
            workspace = Path(tmp) / "workspace"
            other_workspace = Path(tmp) / "other-workspace"
            workspace.mkdir()
            other_workspace.mkdir()
            self._write_meta(root, "my-session", str(workspace.resolve()))

            with mock.patch(
                "backend_core.access.session_meta.agent_window_session_root", return_value=root
            ):
                found = find_session_for_workspace(other_workspace)

            self.assertIsNone(found)

    def test_no_match_when_the_session_root_does_not_exist_yet(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "does-not-exist"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()

            with mock.patch(
                "backend_core.access.session_meta.agent_window_session_root", return_value=root
            ):
                found = find_session_for_workspace(workspace)

            self.assertIsNone(found)

    def test_duplicate_workspace_claims_are_ambiguous(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "session-root"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            self._write_meta(root, "session-a", str(workspace))
            self._write_meta(root, "session-b", str(workspace / ".." / "workspace"))

            with mock.patch(
                "backend_core.access.session_meta.agent_window_session_root", return_value=root
            ):
                with self.assertRaises(WorkspaceClaimConflict) as raised:
                    find_session_for_workspace(workspace)

            self.assertEqual(raised.exception.sessions, ["session-a", "session-b"])

    @staticmethod
    def _draft_handler(workspace: Path):
        body = json.dumps({"workspace": str(workspace)}).encode("utf-8")
        handler = mock.Mock()
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = io.BytesIO(body)
        return handler

    def test_workspace_claim_is_rejected_before_session_name_allocation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "Agent-Window"
            workspace.mkdir()
            handler = self._draft_handler(workspace)
            session_api = mock.Mock()

            with (
                mock.patch(
                    "hub_backend.new_session.handlers.find_session_for_workspace",
                    return_value="existing-session",
                ),
                mock.patch("hub_backend.new_session.handlers.session_artifact_dir") as session_dir,
            ):
                post_start_session_draft(handler, None, {"session_api": session_api})

            handler._send_json.assert_called_once_with(
                409,
                {"ok": False, "error": "A session already exists for this workspace: existing-session"},
            )
            session_dir.assert_not_called()

    def test_duplicate_workspace_basename_gets_an_opaque_session_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "new-parent" / "Agent-Window"
            workspace.mkdir(parents=True)
            session_root = Path(tmp) / "session-root"
            (session_root / "Agent-Window").mkdir(parents=True)
            digest = hashlib.sha256(str(workspace.resolve()).encode("utf-8")).hexdigest()
            (session_root / f"aw-{digest[:8]}").mkdir()
            expected_name = f"aw-{digest[:12]}"
            handler = self._draft_handler(workspace)
            hub = mock.Mock(tmux_socket="agent-window", repo_root=Path(tmp))

            with (
                mock.patch(
                    "hub_backend.new_session.handlers.find_session_for_workspace",
                    return_value=None,
                ),
                mock.patch(
                    "hub_backend.new_session.handlers.session_artifact_dir",
                    side_effect=lambda name: session_root / name,
                ),
                mock.patch("hub_backend.new_session.handlers.create_session") as create_session,
                mock.patch("hub_backend.new_session.handlers.workspace_chat_port", return_value=41000),
                mock.patch("hub_backend.new_session.handlers.port_is_bindable", return_value=True),
                mock.patch(
                    "hub_backend.new_session.handlers.ensure_chat_server",
                    return_value=(True, 41000, ""),
                ),
            ):
                post_start_session_draft(
                    handler,
                    None,
                    {
                        "hub": hub,
                        "format_session_chat_url_fn": (
                            lambda _host, session, _port, _path: f"/session/{session}/"
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
                    "session": expected_name,
                    "chat_url": f"/session/{expected_name}/",
                },
            )
            self.assertIn(expected_name, payload["notice"])
            create_session.assert_called_once_with(
                session_name=expected_name,
                workspace=str(workspace.resolve()),
                agents=[],
                tmux_socket="agent-window",
                repo_root=Path(tmp),
            )

    def test_invalid_meta_is_not_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "session-root"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            session_dir = root / "broken-session"
            session_dir.mkdir(parents=True)
            (session_dir / ".meta").write_text("not-json", encoding="utf-8")

            with mock.patch(
                "backend_core.access.session_meta.agent_window_session_root", return_value=root
            ):
                with self.assertRaises(SessionMetaError):
                    find_session_for_workspace(workspace)

    def test_invalid_meta_only_warns_its_own_hub_record(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "session-root"
            broken_dir = root / "broken-session"
            broken_dir.mkdir(parents=True)
            (broken_dir / ".meta").write_text("not-json", encoding="utf-8")
            runtime = mock.Mock()

            with (
                mock.patch(
                    "backend_core.access.session_meta.agent_window_session_root", return_value=root
                ),
                mock.patch(
                    "hub_backend.session_query.live_tmux_sessions_query",
                    return_value=({}, "ok", ""),
                ),
            ):
                active, warnings, state, detail = collect_repo_sessions(runtime)

            self.assertEqual(active, [])
            self.assertEqual([item["name"] for item in warnings], ["broken-session"])
            self.assertIn("invalid session meta", warnings[0]["warning"])
            self.assertEqual(state, "ok")
            self.assertEqual(detail, "")

    def test_duplicate_claims_are_warning_records_not_active_records(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "session-root"
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            self._write_meta(root, "session-a", str(workspace))
            self._write_meta(root, "session-b", str(workspace))
            runtime = mock.Mock()

            with (
                mock.patch(
                    "backend_core.access.session_meta.agent_window_session_root", return_value=root
                ),
                mock.patch(
                    "hub_backend.session_query.live_tmux_sessions_query",
                    return_value=({str(workspace.resolve()): ("real-tmux", 0)}, "ok", ""),
                ),
            ):
                active, warnings, state, detail = collect_repo_sessions(runtime)

            self.assertEqual(active, [])
            self.assertEqual([item["name"] for item in warnings], ["session-a", "session-b"])
            self.assertEqual(state, "ok")
            self.assertEqual(detail, "")
            runtime.tmux_run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
