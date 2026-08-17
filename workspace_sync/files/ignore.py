from __future__ import annotations

import fnmatch
import os
import time
from pathlib import Path


class FileIndexIgnoreRules:
    CONFIG_REL_PATH = ".agent-window/file-index-ignore"
    RELOAD_INTERVAL_SECONDS = 1.0

    def __init__(self, workspace: str | Path) -> None:
        raw = str(workspace or "").strip()
        self.workspace = os.path.realpath(os.path.normpath(raw)) if raw else ""
        self.config_path = Path(self.workspace) / self.CONFIG_REL_PATH if self.workspace else None
        self._loaded_at = 0.0
        self._mtime_ns: int | None = None
        self._patterns: tuple[str, ...] = ()

    @staticmethod
    def normalize_rel_path(rel: str) -> str:
        return str(rel or "").replace("\\", "/").strip("/")

    @classmethod
    def normalize_pattern(cls, pattern: str) -> str:
        normalized = cls.normalize_rel_path(pattern)
        while normalized.endswith("/"):
            normalized = normalized[:-1]
        return normalized

    def _read_patterns(self) -> tuple[str, ...]:
        if self.config_path is None:
            return ()
        patterns: list[str] = []
        try:
            raw = self.config_path.read_text(encoding="utf-8")
        except OSError:
            return ()
        for line in raw.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            pattern = self.normalize_pattern(stripped)
            if pattern:
                patterns.append(pattern)
        return tuple(dict.fromkeys(patterns))

    def _maybe_reload(self) -> None:
        if self.config_path is None:
            return
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
        normalized = self.normalize_rel_path(rel)
        if not normalized:
            return False
        self._maybe_reload()
        return any(self._matches_pattern(normalized, pattern) for pattern in self._patterns)

    def patterns(self) -> tuple[str, ...]:
        self._maybe_reload()
        return self._patterns
