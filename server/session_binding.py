from __future__ import annotations

import threading
from pathlib import Path

from backend_core.access.session_meta import find_session_for_workspace
from backend_core.access.settings import (
    agent_window_session_root,
    ensure_session_workspace_mirrors,
    session_log_path,
)


class WorkspaceSessionBinding:
    """Project the current AW folder that claims one workspace."""

    def __init__(self, workspace: Path | str) -> None:
        self.workspace = str(Path(workspace).expanduser().resolve())
        self._session_root = agent_window_session_root()
        self._lock = threading.RLock()
        self._root_signature: tuple[int, int] | None = None
        self._session_name = ""
        self._log_path = Path()
        self.refresh(force=True)

    def _current_root_signature(self) -> tuple[int, int]:
        try:
            stat = self._session_root.stat()
        except OSError as exc:
            raise RuntimeError(f"session root is unavailable: {self._session_root}") from exc
        if not self._session_root.is_dir():
            raise RuntimeError(f"session root is not a directory: {self._session_root}")
        return stat.st_mtime_ns, stat.st_ctime_ns

    def refresh(self, *, force: bool = False) -> tuple[str, Path]:
        with self._lock:
            signature = self._current_root_signature()
            if not force and signature == self._root_signature:
                return self._session_name, self._log_path

            session_name = find_session_for_workspace(self.workspace)
            if not session_name:
                raise RuntimeError(f"No agent-window session claims workspace {self.workspace}")
            log_path = session_log_path(session_name)
            if not log_path.is_file():
                raise RuntimeError(f"session log is unavailable: {log_path}")

            ensure_session_workspace_mirrors(session_name, self.workspace)
            self._session_name = session_name
            self._log_path = log_path
            self._root_signature = self._current_root_signature()
            return self._session_name, self._log_path

    def snapshot(self) -> tuple[str, Path]:
        return self.refresh()

    @property
    def session_name(self) -> str:
        return self.refresh()[0]

    @property
    def log_path(self) -> Path:
        return self.refresh()[1]

    @property
    def session_dir(self) -> Path:
        return self.log_path.parent
