from __future__ import annotations

import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend_core.access.session_meta import write_session_meta_file
from hub_backend.chat_supervisor import chat_server_matches, ensure_chat_server
from hub_backend.session_api import HubSessionApi, HubSessionApiContext
from hub_backend.session_query import archived_sessions
from workspace_sync import git as workspace_git


class _Query:
    def __init__(self, records, warnings, state="ok", detail=""):
        self.records = records
        self.warnings = warnings
        self.state = state
        self.detail = detail

    @property
    def non_archived_names(self):
        return set(self.records) | set(self.warnings)


class ArchivedWorkspaceTests(unittest.TestCase):
    def test_warning_session_meta_is_not_reparsed_as_archived(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            session_dir = root / "broken-session"
            session_dir.mkdir()
            (session_dir / ".meta").write_text("[]", encoding="utf-8")
            runtime = SimpleNamespace(central_log_dir=root)

            sessions = archived_sessions(runtime, excluded_names={"broken-session"})

            self.assertEqual(sessions, [])

    def test_archived_sessions_keep_logs_when_meta_has_no_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            session_dir = root / "Even-Parity"
            session_dir.mkdir()
            (session_dir / ".log.jsonl").write_text("", encoding="utf-8")
            (session_dir / ".meta").write_text(
                json.dumps(
                    {
                        "session": "Even-Parity",
                        "agents": ["codex"],
                        "created_at": "2026-05-29 16:54",
                        "updated_at": "2026-08-10 07:56",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            runtime = SimpleNamespace(
                central_log_dir=root,
                repo_root=Path("/Users/okadaharuto/workspace/Agent-Window"),
                chat_port_for_session=lambda _name: 8206,
            )
            sessions = archived_sessions(runtime, excluded_names=set())
            self.assertEqual(len(sessions), 1)
            self.assertEqual(sessions[0]["name"], "Even-Parity")
            self.assertEqual(sessions[0]["workspace"], "")
            self.assertNotEqual(sessions[0]["workspace"], str(runtime.repo_root))

    def test_archived_sessions_keep_logs_when_meta_file_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            session_dir = root / "Broken"
            session_dir.mkdir()
            (session_dir / ".log.jsonl").write_text("", encoding="utf-8")
            runtime = SimpleNamespace(
                central_log_dir=root,
                repo_root=Path("/Users/okadaharuto/workspace/Agent-Window"),
                chat_port_for_session=lambda _name: 8206,
            )
            sessions = archived_sessions(runtime, excluded_names=set())
            self.assertEqual(len(sessions), 1)
            self.assertEqual(sessions[0]["name"], "Broken")
            self.assertEqual(sessions[0]["workspace"], "")

    def test_archived_sessions_keep_a_non_git_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workspace = root / "Lab-workspace"
            workspace.mkdir()
            session_dir = root / "Lab"
            session_dir.mkdir()
            (session_dir / ".log.jsonl").write_text("", encoding="utf-8")
            (session_dir / ".meta").write_text(
                json.dumps(
                    {
                        "workspace": str(workspace),
                        "agents": ["codex"],
                        "created_at": "2026-04-22 23:43",
                        "updated_at": "2026-08-17 23:33",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            runtime = SimpleNamespace(
                central_log_dir=root,
                repo_root=Path("/Users/okadaharuto/workspace/Agent-Window"),
                chat_port_for_session=lambda _name: 8219,
            )
            sessions = archived_sessions(runtime, excluded_names=set())
            self.assertEqual(len(sessions), 1)
            self.assertEqual(sessions[0]["name"], "Lab")
            self.assertEqual(sessions[0]["workspace"], str(workspace))
            self.assertNotEqual(sessions[0]["workspace"], str(runtime.repo_root))
            self.assertFalse((workspace / ".git").exists())

    def test_write_session_meta_does_not_keep_an_old_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            session_dir = Path(tmp) / "Lab"
            session_dir.mkdir()
            meta_path = session_dir / ".meta"
            meta_path.write_text(
                json.dumps({"workspace": "/old/lab"}) + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "AGENT_WINDOW_WORKSPACE"):
                write_session_meta_file("Lab", "codex", "")
            self.assertEqual(json.loads(meta_path.read_text(encoding="utf-8"))["workspace"], "/old/lab")

    def test_archived_open_passes_saved_workspace_not_hub_root(self) -> None:
        captured = {}

        def ensure_chat_server(session_name, *, expected_active=True, workspace=""):
            captured["session_name"] = session_name
            captured["expected_active"] = expected_active
            captured["workspace"] = workspace
            return True, 8206, ""

        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "Even-Parity"
            workspace.mkdir()
            api = HubSessionApi(
                HubSessionApiContext(
                    hub=object(),
                    active_session_records_query=lambda: _Query({}, {}),
                    archived_session_records=lambda _active: {
                        "Even-Parity": {
                            "name": "Even-Parity",
                            "workspace": str(workspace),
                        }
                    },
                    ensure_chat_server=ensure_chat_server,
                )
            )
            resolved = api.resolve_session_chat_target("Even-Parity")
        self.assertEqual(resolved["status"], "ok")
        self.assertEqual(captured["session_name"], "Even-Parity")
        self.assertFalse(captured["expected_active"])
        self.assertEqual(captured["workspace"], str(workspace))
        self.assertNotEqual(captured["workspace"], "/Users/okadaharuto/workspace/Agent-Window")

    def test_archived_open_without_workspace_still_starts_chat(self) -> None:
        captured = {}

        def ensure_chat_server(session_name, *, expected_active=True, workspace=""):
            captured["session_name"] = session_name
            captured["expected_active"] = expected_active
            captured["workspace"] = workspace
            return True, 8206, ""

        api = HubSessionApi(
            HubSessionApiContext(
                hub=object(),
                active_session_records_query=lambda: _Query({}, {}),
                archived_session_records=lambda _active: {
                    "Even-Parity": {
                        "name": "Even-Parity",
                        "workspace": "",
                    }
                },
                ensure_chat_server=ensure_chat_server,
            )
        )
        resolved = api.resolve_session_chat_target("Even-Parity")
        self.assertEqual(resolved["status"], "ok")
        self.assertEqual(captured["session_name"], "Even-Parity")
        self.assertEqual(captured["workspace"], "")

    def test_chat_server_matches_rejects_wrong_workspace(self) -> None:
        hub = SimpleNamespace(
            repo_root=Path("/Users/okadaharuto/workspace/Agent-Window"),
            chat_server_state=lambda _port: {
                "session": "Even-Parity",
                "repo_root": "/Users/okadaharuto/workspace/Agent-Window",
                "workspace": "/Users/okadaharuto/workspace/Agent-Window",
                "targets": [],
                "active": False,
            },
            session_agents=lambda _name: [],
        )
        self.assertFalse(
            chat_server_matches(
                hub,
                "Even-Parity",
                8206,
                workspace="/Users/okadaharuto/workspace/Even-Parity",
            )
        )
        self.assertFalse(chat_server_matches(hub, "Even-Parity", 8206, workspace=""))
        self.assertTrue(
            chat_server_matches(
                hub,
                "Even-Parity",
                8206,
                workspace="/Users/okadaharuto/workspace/Agent-Window",
            )
        )

    def test_archived_launch_argv_is_the_saved_workspace(self) -> None:
        launched = {}

        class _Popen:
            def __init__(self, args, **kwargs):
                launched["args"] = list(args)
                launched["cwd"] = kwargs.get("cwd")

        class _Sys:
            executable = "/usr/bin/python3"

        class _Time:
            @staticmethod
            def monotonic():
                return 0.0

        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "Even-Parity"
            workspace.mkdir()
            hub = SimpleNamespace(
                repo_root=Path("/Users/okadaharuto/workspace/Agent-Window"),
                _get_launch_lock=lambda _name: threading.Lock(),
                archived_session_records=lambda _active: {},
                active_session_records_query=lambda: _Query({}, {}),
                chat_port_for_session=lambda _name: 8206,
                chat_server_state=lambda _port: {
                    "session": "Even-Parity",
                    "repo_root": "/Users/okadaharuto/workspace/Agent-Window",
                    "workspace": str(workspace),
                    "targets": [],
                    "active": False,
                },
                chat_server_matches=lambda *args, **kwargs: True,
                chat_ready=lambda _port: False,
                stop_chat_server=lambda _name: (True, ""),
                stop_inactive_chat_servers=lambda **_kwargs: "",
                _chat_launch_session_dir=lambda *_args: None,
                _chat_launch_env=lambda **_kwargs: {},
                _chat_launch_port=lambda *_args, **_kwargs: (8206, False, ""),
                tmux_run=lambda *_args, **_kwargs: SimpleNamespace(timed_out=False, returncode=0, stderr="", stdout=""),
            )
            with patch("hub_backend.chat_supervisor._wait_until", return_value=True):
                ok, port, detail = ensure_chat_server(
                    hub,
                    "Even-Parity",
                    expected_active=False,
                    workspace=str(workspace),
                    subprocess_module=SimpleNamespace(Popen=_Popen),
                    sys_module=_Sys,
                    time_module=_Time,
                )
        self.assertTrue(ok)
        self.assertEqual(port, 8206)
        self.assertEqual(detail, "")
        self.assertEqual(launched["args"][3], "Even-Parity")
        self.assertEqual(launched["args"][4], str(workspace))
        self.assertEqual(launched["cwd"], "/Users/okadaharuto/workspace/Agent-Window")

    def test_chat_launch_cwd_is_not_a_workspace_that_contains_server_py(self) -> None:
        launched = {}

        class _Popen:
            def __init__(self, args, **kwargs):
                launched["args"] = list(args)
                launched["cwd"] = kwargs.get("cwd")

        class _Sys:
            executable = "/usr/bin/python3"

        class _Time:
            @staticmethod
            def monotonic():
                return 0.0

        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "xray-structure-factor"
            workspace.mkdir()
            (workspace / "server.py").write_text("raise SystemExit('shadow')\n", encoding="utf-8")
            hub = SimpleNamespace(
                repo_root=Path("/Users/okadaharuto/workspace/Agent-Window"),
                _get_launch_lock=lambda _name: threading.Lock(),
                archived_session_records=lambda _active: {},
                active_session_records_query=lambda: _Query({}, {}),
                chat_port_for_session=lambda _name: 8568,
                chat_server_state=lambda _port: {
                    "session": "xray-structure-factor",
                    "repo_root": "/Users/okadaharuto/workspace/Agent-Window",
                    "workspace": str(workspace),
                    "targets": [],
                    "active": False,
                },
                chat_server_matches=lambda *args, **kwargs: True,
                chat_ready=lambda _port: False,
                stop_chat_server=lambda _name: (True, ""),
                stop_inactive_chat_servers=lambda **_kwargs: "",
                _chat_launch_session_dir=lambda *_args: None,
                _chat_launch_env=lambda **_kwargs: {},
                _chat_launch_port=lambda *_args, **_kwargs: (8568, False, ""),
                tmux_run=lambda *_args, **_kwargs: SimpleNamespace(timed_out=False, returncode=0, stderr="", stdout=""),
            )
            with patch("hub_backend.chat_supervisor._wait_until", return_value=True):
                ok, port, detail = ensure_chat_server(
                    hub,
                    "xray-structure-factor",
                    expected_active=False,
                    workspace=str(workspace),
                    subprocess_module=SimpleNamespace(Popen=_Popen),
                    sys_module=_Sys,
                    time_module=_Time,
                )
        self.assertTrue(ok)
        self.assertEqual(port, 8568)
        self.assertEqual(detail, "")
        self.assertEqual(launched["args"][4], str(workspace))
        self.assertEqual(launched["cwd"], "/Users/okadaharuto/workspace/Agent-Window")
        self.assertNotEqual(launched["cwd"], str(workspace))

    def test_ensure_chat_server_opens_logs_without_a_workspace_folder(self) -> None:
        launched = {}

        class _Popen:
            def __init__(self, args, **kwargs):
                launched["args"] = list(args)
                launched["cwd"] = kwargs.get("cwd")

        class _Sys:
            executable = "/usr/bin/python3"

        class _Time:
            @staticmethod
            def monotonic():
                return 0.0

        with tempfile.TemporaryDirectory() as tmp:
            session_dir = Path(tmp) / "Even-Parity"
            session_dir.mkdir()
            hub = SimpleNamespace(
                repo_root=Path("/Users/okadaharuto/workspace/Agent-Window"),
                _get_launch_lock=lambda _name: threading.Lock(),
                archived_session_records=lambda _active: {},
                active_session_records_query=lambda: _Query({}, {}),
                chat_port_for_session=lambda _name: 8206,
                chat_server_state=lambda _port: {
                    "session": "Even-Parity",
                    "repo_root": "/Users/okadaharuto/workspace/Agent-Window",
                    "workspace": "",
                    "targets": [],
                    "active": False,
                },
                chat_server_matches=lambda *args, **kwargs: True,
                chat_ready=lambda _port: False,
                stop_chat_server=lambda _name: (True, ""),
                stop_inactive_chat_servers=lambda **_kwargs: "",
                _chat_launch_session_dir=lambda *_args: session_dir,
                _chat_launch_env=lambda **_kwargs: {},
                _chat_launch_port=lambda *_args, **_kwargs: (8206, False, ""),
                tmux_run=lambda *_args, **_kwargs: SimpleNamespace(timed_out=False, returncode=0, stderr="", stdout=""),
            )
            with patch("hub_backend.chat_supervisor._wait_until", return_value=True):
                ok, port, detail = ensure_chat_server(
                    hub,
                    "Even-Parity",
                    expected_active=False,
                    workspace="",
                    subprocess_module=SimpleNamespace(Popen=_Popen),
                    sys_module=_Sys,
                    time_module=_Time,
                )
        self.assertTrue(ok)
        self.assertEqual(port, 8206)
        self.assertEqual(detail, "")
        self.assertEqual(launched["args"][4], "")
        self.assertEqual(launched["cwd"], "/Users/okadaharuto/workspace/Agent-Window")

    def test_hub_runtime_forwards_workspace_into_chat_server_match(self) -> None:
        import inspect
        from hub_backend.runtime import HubRuntime

        params = inspect.signature(HubRuntime.chat_server_matches).parameters
        self.assertIn("workspace", params)

    def test_git_overview_does_not_use_hub_repo_as_the_project(self) -> None:
        workspace_git.configure(workspace="", runtime=None)
        with self.assertRaisesRegex(RuntimeError, "git workspace is not configured"):
            workspace_git.git_overview()
        with tempfile.TemporaryDirectory() as tmp:
            workspace_git.configure(workspace=tmp, runtime=None)
            self.assertEqual(str(workspace_git._git_root()), tmp)
            self.assertNotEqual(str(workspace_git._git_root()), "/Users/okadaharuto/workspace/Agent-Window")
        workspace_git.configure(workspace="/no/such/even-parity", runtime=None)
        with self.assertRaisesRegex(RuntimeError, "workspace is not available"):
            workspace_git.git_overview()
        workspace_git.configure(workspace="", runtime=None)

    def test_mirrors_do_not_create_a_missing_workspace(self) -> None:
        from backend_core.access.settings import ensure_session_workspace_mirrors

        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "Even-Parity"
            ensure_session_workspace_mirrors("Even-Parity", str(missing))
            self.assertFalse(missing.exists())

    def test_mirrors_link_inside_an_existing_workspace(self) -> None:
        from backend_core.access.settings import (
            SESSION_LOG_FILENAME,
            NATIVE_LOG_STATE_FILENAME,
            ensure_session_workspace_mirrors,
        )

        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "Lab"
            workspace.mkdir()
            canonical = Path(tmp) / "session"
            canonical.mkdir()
            log_target = canonical / SESSION_LOG_FILENAME
            native_target = canonical / NATIVE_LOG_STATE_FILENAME
            log_target.write_text("", encoding="utf-8")
            native_target.write_text("", encoding="utf-8")
            with patch("backend_core.access.settings.session_log_path", return_value=log_target), patch(
                "backend_core.access.settings.session_native_log_state_path",
                return_value=native_target,
            ):
                ensure_session_workspace_mirrors("Lab", str(workspace))
            link = workspace / ".agent-window" / SESSION_LOG_FILENAME
            self.assertTrue(link.is_symlink())
            self.assertEqual(link.resolve(), log_target.resolve())

    def test_chat_launch_does_not_touch_a_missing_workspace(self) -> None:
        from hub_backend.chat_supervisor import chat_launch_session_dir

        with tempfile.TemporaryDirectory() as tmp:
            logs = Path(tmp) / "logs"
            missing = Path(tmp) / "Even-Parity"
            hub = SimpleNamespace(repo_root=Path(tmp) / "hub")
            with patch("hub_backend.chat_supervisor.agent_window_session_root", return_value=logs), patch(
                "hub_backend.chat_supervisor.session_log_path",
                return_value=logs / "Even-Parity" / ".log.jsonl",
            ):
                session_dir = chat_launch_session_dir(hub, "Even-Parity")
            self.assertEqual(session_dir, logs / "Even-Parity")
            self.assertTrue(session_dir.is_dir())
            self.assertFalse(missing.exists())


if __name__ == "__main__":
    unittest.main()
