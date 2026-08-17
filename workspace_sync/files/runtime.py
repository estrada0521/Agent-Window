from __future__ import annotations
import logging
import re

import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from workspace_sync.files.ignore import FileIndexIgnoreRules


class FileRuntime:
    INLINE_PROGRESSIVE_PREVIEW_MAX_BYTES = 512 * 1024
    RAW_STREAM_CHUNK_BYTES = 64 * 1024
    PROGRESSIVE_TEXT_PREVIEW_CHUNK_BYTES = 32 * 1024
    FILE_LIST_CACHE_TTL_SECONDS = 45
    FILE_SEARCH_MAX_LIMIT = 200
    MIME_TYPES = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".html": "text/html; charset=utf-8",
        ".htm": "text/html; charset=utf-8",
        ".ico": "image/x-icon",
        ".pdf": "application/pdf",
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".webm": "video/webm",
        ".avi": "video/x-msvideo",
        ".mkv": "video/x-matroska",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",
        ".flac": "audio/flac",
    }
    IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"}
    TEXT_EXTS = {".py", ".js", ".json", ".yaml", ".yml", ".sh", ".sql", ".html", ".css", ".tex", ".txt", ".csv", ".log"}
    EDITABLE_TEXT_EXTS = TEXT_EXTS | {".md", ".ts", ".tsx", ".jsx", ".toml", ".ini", ".cfg", ".conf", ".rst", ".env"}
    PDF_EXTS = {".pdf"}
    VIDEO_EXTS = {
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".webm": "video/webm",
        ".avi": "video/x-msvideo",
        ".mkv": "video/x-matroska",
    }
    AUDIO_EXTS = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",
        ".flac": "audio/flac",
    }
    SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".mypy_cache", ".agent-window"}

    def __init__(
        self,
        *,
        workspace: str | Path,
        allowed_roots: list[str | Path] | tuple[str | Path, ...] | None = None,
        repo_root: str | Path | None = None,
    ):
        raw = str(workspace or "").strip()
        self.workspace = os.path.realpath(os.path.normpath(raw)) if raw else ""
        self.repo_root = os.path.realpath(os.path.normpath(str(repo_root))) if repo_root else None
        roots = [self.workspace] if self.workspace else []
        for candidate in allowed_roots or ():
            if not candidate:
                continue
            resolved = os.path.realpath(os.path.normpath(str(candidate)))
            if resolved not in roots:
                roots.append(resolved)
        self.allowed_roots = tuple(roots)
        self._file_list_cache: list[dict] | None = None
        self._file_list_cache_at = 0.0
        self._file_list_cache_lock = threading.Lock()
        self._file_list_refresh_lock = threading.Lock()
        self._file_list_cache_version = 0
        self._file_index_ignore = FileIndexIgnoreRules(self.workspace)

    def _is_allowed_path(self, full: str) -> bool:
        try:
            resolved = os.path.realpath(full)
        except OSError:
            return False
        if not resolved:
            return False
        for root in self.allowed_roots:
            if resolved == root or resolved.startswith(root + os.sep):
                return True
        return False

    @staticmethod
    def _normalize_rel_path(rel: str) -> str:
        return FileIndexIgnoreRules.normalize_rel_path(rel)

    def _rel_path_is_skipped(self, rel: str) -> bool:
        normalized = self._normalize_rel_path(rel)
        if not normalized:
            return False
        parts = Path(normalized).parts
        if any(part in self.SKIP_DIRS for part in parts):
            return True
        return self._file_index_ignore.matches(normalized)

    def file_index_path_is_ignored(self, rel: str) -> bool:
        return self._rel_path_is_skipped(rel)

    def _require_workspace(self) -> str:
        root = str(self.workspace or "").strip()
        if not root:
            raise RuntimeError("workspace is not configured")
        if not os.path.isdir(root):
            raise RuntimeError("workspace is not available")
        return root

    def _resolve_path(self, rel: str, *, allow_workspace_root: bool = False) -> str:
        self._require_workspace()
        rel = rel or ""
        if rel.startswith("~"):
            full = os.path.realpath(os.path.expanduser(rel))
        elif os.path.isabs(rel):
            full = os.path.realpath(os.path.normpath(rel))
        else:
            full = os.path.realpath(os.path.join(self.workspace, rel.lstrip("/")))
        if not self._is_allowed_path(full):
            raise PermissionError(full)
        return full

    def _resolve_reference_path(self, rel: str) -> str:
        """Resolve a chat-style file reference (workspace-relative or fully
        qualified). A fully-qualified path is self-contained -- it doesn't
        need a root to disambiguate -- so it bypasses workspace containment;
        a relative reference stays confined to the workspace via
        _resolve_path.
        """
        rel_raw = str(rel or "").strip()
        if rel_raw.startswith("~") or os.path.isabs(rel_raw):
            return os.path.realpath(os.path.expanduser(rel_raw))
        return self._resolve_path(rel_raw, allow_workspace_root=True)

    def files_exist(self, paths: list[str]) -> dict[str, bool]:
        result = {}
        for rel in paths:
            try:
                result[rel] = os.path.exists(self._resolve_reference_path(rel))
            except (PermissionError, Exception):
                result[rel] = False
        return result

    @classmethod
    def content_type_for_rel(cls, rel: str) -> str:
        ext = os.path.splitext(rel)[1].lower()
        return cls.MIME_TYPES.get(ext, "application/octet-stream")

    @staticmethod
    def _parse_single_range(range_header: str, size: int):
        if not range_header:
            return 0, max(0, size - 1), False
        if size <= 0 or not range_header.startswith("bytes="):
            raise ValueError("invalid range")
        spec = range_header[6:].strip()
        if not spec or "," in spec or "-" not in spec:
            raise ValueError("invalid range")
        start_raw, end_raw = spec.split("-", 1)
        if not start_raw:
            suffix_length = int(end_raw or "0")
            if suffix_length <= 0:
                raise ValueError("invalid range")
            start = max(0, size - suffix_length)
            end = size - 1
        else:
            start = int(start_raw)
            end = size - 1 if not end_raw else int(end_raw)
            if start < 0 or end < start or start >= size:
                raise ValueError("invalid range")
            end = min(end, size - 1)
        return start, end, True

    def raw_response_metadata(self, rel: str, range_header: str = "") -> dict:
        full = self._resolve_reference_path(rel)
        size = os.path.getsize(full)
        try:
            start, end, is_partial = self._parse_single_range(range_header, size)
        except ValueError:
            return {
                "status": 416,
                "size": size,
                "content_type": self.content_type_for_rel(rel),
                "full_path": full,
            }
        if size == 0:
            start = 0
            end = -1
            is_partial = False
        length = 0 if end < start else (end - start + 1)
        return {
            "status": 206 if is_partial else 200,
            "size": size,
            "start": start,
            "end": end,
            "length": length,
            "is_partial": is_partial,
            "content_type": self.content_type_for_rel(rel),
            "content_range": f"bytes {start}-{end}/{size}" if is_partial else "",
            "full_path": full,
        }

    @classmethod
    def stream_raw_response(cls, metadata: dict, write):
        length = int(metadata.get("length", 0) or 0)
        if length <= 0:
            return
        full_path = str(metadata.get("full_path") or "")
        start = int(metadata.get("start", 0) or 0)
        with open(full_path, "rb") as handle:
            handle.seek(start)
            remaining = length
            while remaining > 0:
                chunk = handle.read(min(cls.RAW_STREAM_CHUNK_BYTES, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                if write(chunk) is False:
                    break

    @staticmethod
    def _is_probably_text_file(full: str) -> bool:
        try:
            with open(full, "rb") as f:
                sample = f.read(4096)
        except OSError:
            return False
        if not sample:
            return True
        return b"\x00" not in sample

    @staticmethod
    def _reveal_in_finder(full: str) -> None:
        if sys.platform == "darwin":
            reveal_cmd = ["open", "-R", full]
        elif shutil.which("xdg-open"):
            reveal_cmd = ["xdg-open", full if os.path.isdir(full) else os.path.dirname(full)]
        else:
            raise ValueError("No handler available to reveal this file.")
        subprocess.Popen(
            reveal_cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

    @classmethod
    def _open_with_system_default(cls, full: str) -> bool:
        if sys.platform == "darwin":
            open_cmd = ["open", full]
        elif shutil.which("xdg-open"):
            open_cmd = ["xdg-open", full]
        else:
            raise ValueError("No handler available to open this file with the system default.")

        try:
            result = subprocess.run(
                open_cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            result = None
        if result is not None and result.returncode == 0:
            return False

        cls._reveal_in_finder(full)
        return True

    def _resolve_open_target(self, rel: str) -> str:
        if not str(rel or "").strip():
            raise ValueError("path required")
        full = self._resolve_reference_path(rel)
        if not os.path.exists(full):
            raise FileNotFoundError(full)
        return full

    def open_in_editor(self, rel: str, line: int = 0):
        del line
        full = self._resolve_open_target(rel)
        revealed = self._open_with_system_default(full)
        return {"ok": True, "path": rel, "revealed_in_finder": revealed}

    def reveal_in_finder(self, rel: str):
        full = self._resolve_open_target(rel)
        self._reveal_in_finder(full)
        return {"ok": True, "path": rel, "revealed_in_finder": True}

    def invalidate_file_list_cache(self) -> None:
        with self._file_list_cache_lock:
            self._file_list_cache = None
            self._file_list_cache_at = 0.0
            self._file_list_cache_version += 1

    def refresh_file_list_cache(self) -> list[dict]:
        self._require_workspace()
        if not self._file_list_refresh_lock.acquire(blocking=False):
            with self._file_list_cache_lock:
                return [dict(item) for item in (self._file_list_cache or [])]
        try:
            files = self._git_search_paths()
            with self._file_list_cache_lock:
                self._file_list_cache = files
                self._file_list_cache_at = time.time()
                self._file_list_cache_version += 1
                return [dict(item) for item in files]
        finally:
            self._file_list_refresh_lock.release()

    def _git_search_paths(self) -> list[dict]:
        result = subprocess.run(
            ["git", "-C", self.workspace, "ls-files", "-z", "-c", "-o", "--exclude-standard"],
            check=False,
            capture_output=True,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or b"").decode("utf-8", "replace").strip()
            raise RuntimeError(detail or f"git ls-files exited {result.returncode}")
        files: list[dict] = []
        for raw in (result.stdout or b"").split(b"\0"):
            if not raw:
                continue
            rel = raw.decode("utf-8", "replace").replace("\\", "/")
            if not rel or self._rel_path_is_skipped(rel):
                continue
            files.append({"path": rel, "size": None})
        files.sort(key=lambda item: str(item.get("path") or "").casefold())
        return files

    def file_list_cache_state(self) -> dict[str, int | float]:
        with self._file_list_cache_lock:
            return {
                "version": int(self._file_list_cache_version),
                "updated_at": float(self._file_list_cache_at),
                "entry_count": len(self._file_list_cache or ()),
            }

    @staticmethod
    def _basename(path: str) -> str:
        s = str(path or "")
        i = max(s.rfind("/"), s.rfind("\\"))
        return s if i == -1 else s[i + 1 :]

    @staticmethod
    def _stem_from_base(base: str) -> str:
        return re.sub(r"\.[^.]+$", "", str(base or ""))

    @staticmethod
    def _normalized_loose_file_token(value: str) -> str:
        return re.sub(r"[^a-z0-9]", "", str(value or "").lower())

    def list_files(self, *, force_refresh: bool = False):
        now = time.time()
        if not force_refresh:
            with self._file_list_cache_lock:
                if (
                    self._file_list_cache is not None
                    and (now - self._file_list_cache_at) <= self.FILE_LIST_CACHE_TTL_SECONDS
                ):
                    return [dict(item) for item in self._file_list_cache]
        return self.refresh_file_list_cache()

    def resolve_file_reference(self, query: str) -> str:
        raw_query = str(query or "").strip()
        if not raw_query:
            return ""
        if raw_query.startswith("~") or os.path.isabs(raw_query):
            # A fully-qualified reference is unambiguous on its own; it
            # doesn't need to be matched against this workspace's file index.
            full = self._resolve_reference_path(raw_query)
            return full if os.path.exists(full) else ""
        normalized_query = raw_query.replace("\\", "/").lstrip("./").strip("/")
        if not normalized_query:
            return ""
        entries = self.list_files(force_refresh=False)
        if not entries:
            return ""

        variants = {normalized_query}
        if raw_query.startswith("/"):
            variants.add(raw_query.lstrip("/"))
        if raw_query.startswith("~/"):
            variants.add(raw_query[2:])
        lowered_variants = {item.lower() for item in variants if item}

        for lowered in lowered_variants:
            for entry in entries:
                path = str(entry.get("path") or "")
                if path.lower() == lowered:
                    return path

        if raw_query.startswith("/"):
            lowered = raw_query.lower()
            suffix_matches = []
            for entry in entries:
                rel = str(entry.get("path") or "")
                rel_lower = rel.lower()
                if lowered == rel_lower or lowered.endswith(f"/{rel_lower}"):
                    suffix_matches.append(rel)
            if len(suffix_matches) == 1:
                return suffix_matches[0]

        query_base = self._basename(normalized_query).lower()
        query_stem = self._stem_from_base(query_base)
        query_loose = self._normalized_loose_file_token(query_stem)

        exact_base_matches = []
        exact_stem_matches = []
        loose_stem_matches = []
        for entry in entries:
            path = str(entry.get("path") or "")
            if not path:
                continue
            rel_base = self._basename(path).lower()
            rel_stem = self._stem_from_base(rel_base)
            if rel_base == query_base:
                exact_base_matches.append(path)
            if rel_stem == query_stem:
                exact_stem_matches.append(path)
            if query_loose and self._normalized_loose_file_token(rel_stem) == query_loose:
                loose_stem_matches.append(path)

        for match_set in (exact_base_matches, exact_stem_matches, loose_stem_matches):
            deduped = sorted(set(match_set))
            if len(deduped) == 1:
                return deduped[0]

        return ""

    def resolve_file_references(self, queries: list[str]) -> dict[str, str]:
        result: dict[str, str] = {}
        seen: set[str] = set()
        for raw in queries:
            query = str(raw or "").strip()
            if not query or query in seen:
                continue
            seen.add(query)
            result[query] = self.resolve_file_reference(query)
        return result

    def search_files(self, query: str = "", limit: int = 60, *, force_refresh: bool = False):
        def hydrate_size(entry: dict) -> dict:
            result = dict(entry)
            if result.get("size") is not None:
                return result
            rel = str(result.get("path") or "")
            if not rel:
                result["size"] = None
                return result
            try:
                full = self._resolve_path(rel, allow_workspace_root=True)
            except PermissionError:
                result["size"] = None
                return result
            try:
                result["size"] = os.path.getsize(full) if os.path.isfile(full) else None
            except OSError:
                result["size"] = None
            return result

        def ranking_penalty(path_lower: str) -> int:
            parts = [part for part in str(path_lower or "").split("/") if part]
            penalty = 0
            if parts and parts[0].startswith("."):
                penalty += 1
            noisy_dirs = {
                "node_modules",
                ".venv",
                "venv",
                "__pycache__",
                ".mypy_cache",
                "site-packages",
                "target",
                "build",
                "dist",
                "tmp",
            }
            for part in parts[:-1]:
                if part in noisy_dirs:
                    penalty += 3
                elif part.endswith(".app"):
                    penalty += 2
                elif part.startswith("."):
                    penalty += 1
            return penalty

        try:
            normalized_limit = int(limit)
        except (TypeError, ValueError):
            normalized_limit = 60
        normalized_limit = max(1, min(self.FILE_SEARCH_MAX_LIMIT, normalized_limit))
        entries = self.list_files(force_refresh=force_refresh)
        needle = str(query or "").strip().lower()
        if not needle:
            preferred_text_exts = self.EDITABLE_TEXT_EXTS | {".md"}
            ranked_default = sorted(
                entries,
                key=lambda entry: (
                    ranking_penalty(str(entry.get("path") or "").lower()),
                    0
                    if os.path.splitext(str(entry.get("path") or "").lower())[1] in preferred_text_exts
                    else 1,
                    str(entry.get("path") or "").count("/"),
                    len(str(entry.get("path") or "")),
                    str(entry.get("path") or "").lower(),
                ),
            )
            return [hydrate_size(entry) for entry in ranked_default[:normalized_limit]]

        ranked: list[tuple[tuple[int, int, int, int, str], dict]] = []
        for entry in entries:
            path = str(entry.get("path") or "")
            if not path:
                continue
            path_lower = path.lower()
            base_lower = os.path.basename(path_lower)
            penalty = ranking_penalty(path_lower)
            score: tuple[int, int, int, int, str] | None = None
            if base_lower == needle or path_lower == needle:
                score = (0, penalty, 0, len(path_lower), path_lower)
            elif base_lower.startswith(needle):
                score = (1, penalty, 0, len(base_lower), path_lower)
            else:
                base_hit = base_lower.find(needle)
                if base_hit >= 0:
                    score = (2, penalty, base_hit, len(base_lower), path_lower)
                else:
                    path_hit = path_lower.find(needle)
                    if path_hit >= 0:
                        score = (3, penalty, path_hit, len(path_lower), path_lower)
            if score is not None:
                ranked.append((score, entry))

        ranked.sort(key=lambda item: item[0])
        return [hydrate_size(item[1]) for item in ranked[:normalized_limit]]

    def list_dir(self, rel: str = ""):
        normalized_rel = str(rel or "").replace("\\", "/").strip("/")
        full = self._resolve_path(normalized_rel, allow_workspace_root=True)
        if not os.path.isdir(full):
            raise NotADirectoryError(full)
        entries: list[dict] = []
        with os.scandir(full) as scanner:
            for entry in scanner:
                child_rel = f"{normalized_rel}/{entry.name}" if normalized_rel else entry.name
                if self._rel_path_is_skipped(child_rel):
                    continue
                is_dir = False
                try:
                    is_dir = entry.is_dir(follow_symlinks=False)
                except OSError:
                    try:
                        is_dir = entry.is_dir(follow_symlinks=True)
                    except OSError:
                        is_dir = False
                item = {
                    "name": entry.name,
                    "path": child_rel,
                    "kind": "dir" if is_dir else "file",
                    "size": None,
                }
                if not is_dir:
                    try:
                        item["size"] = entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        item["size"] = None
                entries.append(item)
        entries.sort(key=lambda item: (item.get("kind") != "dir", str(item.get("name") or "").casefold()))
        return entries

    def file_view(
        self,
        rel: str,
        *,
        embed: bool = False,
        pane: bool = False,
        base_path: str = "",
        preview_base_theme: str = "",
        preview_variant: str = "",
        agent_font_mode: str = "serif",
        agent_font_family: str | None = None,
        agent_text_size: int | None = None,
        preview_chrome: str = "",
        force_progressive_text: bool = False,
    ) -> str:
        from .view import render_file_view

        return render_file_view(
            self,
            rel,
            embed=embed,
            pane=pane,
            base_path=base_path,
            preview_base_theme=preview_base_theme,
            preview_variant=preview_variant,
            agent_font_mode=agent_font_mode,
            agent_font_family=agent_font_family,
            agent_text_size=agent_text_size,
            preview_chrome=preview_chrome,
            force_progressive_text=force_progressive_text,
        )
