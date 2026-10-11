from __future__ import annotations

import fnmatch
import time
from pathlib import Path


class FileIndexIgnoreRules:
    CONFIG_REL_PATH = ".agent-window/file-index-ignore"
    RELOAD_INTERVAL_SECONDS = 1.0

    def __init__(self, workspace: str) -> None:
        self.config_path = Path(workspace) / self.CONFIG_REL_PATH
        self._loaded_at = 0.0
        self._mtime_ns: int | None = None
        self._patterns: tuple[str, ...] = ()

    def _read_patterns(self) -> tuple[str, ...]:
        patterns: list[str] = []
        try:
            raw = self.config_path.read_text(encoding="utf-8")
        except OSError:
            return ()
        for line in raw.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            pattern = stripped.strip("/")
            if pattern:
                patterns.append(pattern)
        return tuple(dict.fromkeys(patterns))

    def _maybe_reload(self) -> None:
        now = time.monotonic()
        if now - self._loaded_at < self.RELOAD_INTERVAL_SECONDS:
            return
        self._loaded_at = now
        try:
            mtime_ns = self.config_path.stat().st_mtime_ns
        except OSError:
            mtime_ns = None
        if mtime_ns == self._mtime_ns:
            return
        self._mtime_ns = mtime_ns
        self._patterns = self._read_patterns()

    @staticmethod
    def _matches_pattern(rel: str, pattern: str) -> bool:
        if any(char in pattern for char in "*?["):
            return fnmatch.fnmatchcase(rel, pattern) or fnmatch.fnmatchcase(f"{rel}/", pattern)
        return rel == pattern or rel.startswith(f"{pattern}/")

    def matches(self, rel: str) -> bool:
        self._maybe_reload()
        return any(self._matches_pattern(rel, pattern) for pattern in self._patterns)

    def patterns(self) -> tuple[str, ...]:
        self._maybe_reload()
        return self._patterns
