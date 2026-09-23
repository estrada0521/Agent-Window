from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Callable, Iterable

from workspace_sync.files.runtime import FileRuntime
from . import git as workspace_git
from .watch import start_workspace_fsevents_watcher


class WorkspaceSyncApi:
    def __init__(
        self,
        *,
        workspace: str | Path,
        allowed_roots: list[str | Path] | tuple[str | Path, ...] | None = None,
        allowed_roots_fn: Callable[[], Iterable[str | Path]] | None = None,
        repo_root: str | Path | None = None,
        runtime,
    ) -> None:
        self.workspace = str(workspace)
        self.runtime = runtime
        self._sync_event_condition = threading.Condition()
        self._sync_event_seq = 0
        self._git_cache_version = 0
        self.file_runtime = FileRuntime(
            workspace=workspace,
            allowed_roots=allowed_roots,
            allowed_roots_fn=allowed_roots_fn,
            repo_root=repo_root,
        )
        workspace_git.configure(workspace=self.workspace)
        start_workspace_fsevents_watcher(self)

    def raw_response_metadata(self, rel: str, range_header: str = "") -> dict:
        return self.file_runtime.raw_response_metadata(rel, range_header)

    def stream_raw_response(self, metadata: dict, write) -> None:
        self.file_runtime.stream_raw_response(metadata, write)

    def file_view(self, rel: str, **kwargs):
        return self.file_runtime.file_view(rel, **kwargs)

    def invalidate_file_index_cache(self) -> None:
        self.file_runtime.invalidate_file_list_cache()

    def invalidate_git_cache(self, *, head_changed: bool = False) -> None:
        workspace_git.invalidate_git_cache(include_commits=head_changed)
        with self._sync_event_condition:
            self._git_cache_version += 1

    def _workspace_sync_state_locked(self) -> dict[str, int]:
        return {
            "seq": self._sync_event_seq,
            "file_version": self.file_runtime.file_list_cache_version(),
            "git_version": self._git_cache_version,
        }

    def workspace_sync_state(self) -> dict[str, int]:
        with self._sync_event_condition:
            return self._workspace_sync_state_locked()

    def publish_sync_event(self) -> None:
        with self._sync_event_condition:
            self._sync_event_seq += 1
            self._sync_event_condition.notify_all()

    def wait_for_sync_event(self, after_seq: int, timeout: float = 15.0) -> dict[str, int] | None:
        deadline = time.monotonic() + timeout
        with self._sync_event_condition:
            while self._sync_event_seq <= after_seq:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._sync_event_condition.wait(timeout=remaining)
            return self._workspace_sync_state_locked()

    def search_files(self, query: str = "", limit: int = 60):
        return self.file_runtime.search_files(query, limit=limit)

    def resolve_file_references(self, queries: list[str]) -> dict[str, str]:
        return self.file_runtime.resolve_file_references(queries)

    def list_dir(self, rel: str = ""):
        return self.file_runtime.list_dir(rel)

    def files_exist(self, paths: list[str]) -> dict[str, bool]:
        return self.file_runtime.files_exist(paths)

    def open_with_default_app(self, rel: str):
        return self.file_runtime.open_with_default_app(rel)

    def reveal_in_finder(self, rel: str):
        return self.file_runtime.reveal_in_finder(rel)

    def quick_look(self, rels: list[str]):
        return self.file_runtime.quick_look(rels)

    def git_overview(self, *, offset=0, limit=50, force_refresh: bool = False, include_commits: bool = True):
        return workspace_git.git_overview(
            offset=offset,
            limit=limit,
            force_refresh=force_refresh,
            include_commits=include_commits,
        )

    def git_diff_files(self, *, commit_hash: str = "", scope: str = ""):
        return workspace_git.git_diff_files(commit_hash=commit_hash, scope=scope)

    def git_commit_info(self, *, commit_hash: str):
        return workspace_git.git_commit_info(commit_hash=commit_hash)

    def open_diff_tool(self, rel_path: str, commit_hash: str = "", old_path: str = ""):
        return workspace_git.open_diff_tool(rel_path, commit_hash, old_path)
