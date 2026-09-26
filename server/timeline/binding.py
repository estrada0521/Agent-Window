from __future__ import annotations

import threading
from pathlib import Path

from fs.log.meta import find_timeline_name_for_workspace
from fs.log.paths import (
    agent_window_log_root,
    log_jsonl_path,
)


class WorkspaceTimelineBinding:

    def __init__(self, workspace: Path | str) -> None:
        self.workspace = str(Path(workspace).expanduser().resolve())
        self._log_root = agent_window_log_root()
        self._lock = threading.RLock()
        self._root_signature: tuple[int, int] | None = None
        self._timeline_name = ""
        self._log_path = Path()
        self.refresh(force=True)

    def _current_root_signature(self) -> tuple[int, int]:
        try:
            stat = self._log_root.stat()
        except OSError as exc:
            raise RuntimeError(f"log root is unavailable: {self._log_root}") from exc
        if not self._log_root.is_dir():
            raise RuntimeError(f"log root is not a directory: {self._log_root}")
        return stat.st_mtime_ns, stat.st_ctime_ns

    def refresh(self, *, force: bool = False) -> tuple[str, Path]:
        with self._lock:
            signature = self._current_root_signature()
            if not force and signature == self._root_signature:
                return self._timeline_name, self._log_path

            timeline_name = find_timeline_name_for_workspace(self.workspace)
            if not timeline_name:
                raise RuntimeError(f"No agent-window timeline claims workspace {self.workspace}")
            log_path = log_jsonl_path(timeline_name)
            self._timeline_name = timeline_name
            self._log_path = log_path
            self._root_signature = self._current_root_signature()
            return self._timeline_name, self._log_path

    def snapshot(self) -> tuple[str, Path]:
        return self.refresh()

    @property
    def timeline_name(self) -> str:
        return self.refresh()[0]

    @property
    def log_path(self) -> Path:
        return self.refresh()[1]

    @property
    def log_dir(self) -> Path:
        return self.log_path.parent
