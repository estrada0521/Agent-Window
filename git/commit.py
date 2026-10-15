from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Callable


class CommitAnnouncer:
    def __init__(self, workspace: str, announce: Callable[[dict], None]) -> None:
        self.workspace = workspace
        self._announce = announce
        self._path: Path | None = None
        self._identity: tuple[int, int] | None = None
        self._position: int | None = None

    def _git(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["git", "-C", self.workspace, *args],
            capture_output=True, text=True, timeout=2, check=False,
        )

    def _open_reflog(self):
        if self._path is None:
            result = self._git("rev-parse", "--path-format=absolute", "--git-path", "logs/HEAD")
            if result.returncode != 0:
                if "not a git repository" in result.stderr:
                    return None
                raise RuntimeError(result.stderr.strip())
            self._path = Path(result.stdout.strip())
        try:
            return self._path.open("rb")
        except FileNotFoundError:
            if self._identity is not None:
                raise RuntimeError("HEAD reflog disappeared; reload Hub to resume commit tracking")
            result = self._git("rev-parse", "--verify", "--quiet", "HEAD")
            if result.returncode == 1:
                return None
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip())
            raise RuntimeError("HEAD reflog unavailable")

    def adopt_baseline(self) -> None:
        source = self._open_reflog()
        if source is None:
            self._position = 0
            return
        with source:
            stat = os.fstat(source.fileno())
            self._identity = (stat.st_dev, stat.st_ino)
            self._position = source.seek(0, os.SEEK_END)

    def observe(self) -> None:
        if self._position is None:
            raise RuntimeError("Commit tracking not initialized; reload Hub to resume")
        source = self._open_reflog()
        if source is None:
            return
        with source:
            stat = os.fstat(source.fileno())
            identity = (stat.st_dev, stat.st_ino)
            if (self._identity is not None and self._identity != identity) or stat.st_size < self._position:
                self._position = None
                raise RuntimeError("HEAD reflog replaced or truncated; reload Hub to resume commit tracking")
            self._identity = identity
            source.seek(self._position)
            while line := source.readline():
                if not line.endswith(b"\n"):
                    raise RuntimeError("Incomplete HEAD reflog entry")
                record, message = line[:-1].split(b"\t", 1)
                commit_hash = record.split(b" ", 2)[1].decode("ascii")
                self._announce({"hash": commit_hash, "short": commit_hash[:7], "message": message.decode("utf-8")})
                self._position = source.tell()
