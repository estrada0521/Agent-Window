from __future__ import annotations

import datetime as dt
import json
import logging
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote

from backend_core.access.settings import session_log_path


_PREVIEW_TAIL_BYTES = 2 * 1024 * 1024
_PREVIEW_TAIL_CHUNK_BYTES = 64 * 1024


def parse_session_dir(name: str) -> str:
    return name


def count_nonempty_lines(path: Path) -> int:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return sum(1 for line in handle if line.strip())
    except Exception as exc:
        logging.error(f"Unexpected error: {exc}", exc_info=True)
        return 0


def parse_saved_time(value: str) -> float:
    if not value:
        return 0
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return dt.datetime.strptime(value, fmt).timestamp()
        except ValueError:
            pass
    return 0


def format_epoch(epoch: float) -> str:
    if not epoch:
        return ""
    try:
        return dt.datetime.fromtimestamp(epoch).strftime("%Y-%m-%d %H:%M")
    except Exception as exc:
        logging.error(f"Unexpected error: {exc}", exc_info=True)
        return ""


def _compact_message_preview(entry: dict[str, Any]) -> dict[str, str]:
    sender = (entry.get("sender") or "").strip()
    if sender == "system":
        return {"sender": "", "text": ""}
    message = str(entry.get("message") or "").strip()
    if not message:
        return {"sender": "", "text": ""}
    compact = re.sub(r"^\[From:\s*[^\]]+\]\s*", "", message, flags=re.IGNORECASE)
    compact = re.sub(r"^\[[^\]]*msg-id:[^\]]+\]\s*", "", compact, flags=re.IGNORECASE)
    compact = re.sub(r"\s+", " ", compact)
    compact = re.sub(r"\[Attached:\s*[^\]]+\]", "", compact).strip()
    compact = compact[:140].rstrip()
    if not compact:
        return {"sender": "", "text": ""}
    return {"sender": sender, "text": compact}


def _iter_tail_lines(path: Path, *, max_bytes: int = _PREVIEW_TAIL_BYTES):
    try:
        with path.open("rb") as handle:
            handle.seek(0, 2)
            pos = handle.tell()
            remaining = min(max_bytes, pos)
            buffer = b""
            while pos > 0 and remaining > 0:
                read_size = min(_PREVIEW_TAIL_CHUNK_BYTES, pos, remaining)
                pos -= read_size
                remaining -= read_size
                handle.seek(pos)
                buffer = handle.read(read_size) + buffer
                parts = buffer.split(b"\n")
                if pos > 0 and remaining > 0:
                    buffer = parts[0]
                    parts = parts[1:]
                else:
                    buffer = b""
                for raw in reversed(parts):
                    if raw.strip():
                        yield raw.decode("utf-8", errors="replace")
    except Exception as exc:
        logging.error(f"Unexpected error: {exc}", exc_info=True)


def _latest_message_preview_from_full_scan(log_path: Path) -> dict[str, str]:
    last_preview = {"sender": "", "text": ""}
    with log_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            except Exception as exc:
                logging.error(f"Unexpected error: {exc}", exc_info=True)
                continue
            preview = _compact_message_preview(entry)
            if preview["text"]:
                last_preview = preview
    return last_preview


def latest_message_preview(log_path: Path | None) -> dict[str, str]:
    if not log_path or not log_path.is_file():
        return {"sender": "", "text": ""}
    try:
        size = log_path.stat().st_size
        for line in _iter_tail_lines(log_path):
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            except Exception as exc:
                logging.error(f"Unexpected error: {exc}", exc_info=True)
                continue
            preview = _compact_message_preview(entry)
            if preview["text"]:
                return preview
        if size > _PREVIEW_TAIL_BYTES:
            return _latest_message_preview_from_full_scan(log_path)
    except Exception as exc:
        logging.error(f"Unexpected error: {exc}", exc_info=True)
        return {"sender": "", "text": ""}
    return {"sender": "", "text": ""}


def host_without_port(host_header: str) -> str:
    host = (host_header or "").strip() or "127.0.0.1"
    if host.startswith("["):
        end = host.find("]")
        return host[: end + 1] if end != -1 else host
    return host.split(":", 1)[0]


def build_session_record(
    runtime: Any,
    *,
    name: str,
    workspace: str,
    agents: list[str],
    status: str,
    attached: int,
    dead_panes: int,
    created_epoch: int = 0,
    created_at: str = "",
    updated_epoch: int = 0,
    updated_at: str = "",
    log_path: Path | None = None,
) -> dict:
    path = Path(log_path) if log_path is not None else session_log_path(name)
    primary = path if path.is_file() else None
    preview = latest_message_preview(primary)
    session_slug = quote(name, safe="")
    return {
        "name": name,
        "workspace": workspace,
        "created_at": created_at,
        "created_epoch": int(created_epoch or 0),
        "updated_at": updated_at,
        "updated_epoch": int(updated_epoch or 0),
        "attached": int(attached or 0),
        "dead_panes": int(dead_panes or 0),
        "agents": list(agents or []),
        "status": status,
        "chat_port": runtime.chat_port_for_session(name),
        "session_path": f"/session/{session_slug}/",
        "log_dir": str(path.parent),
        "log_path": str(path),
        "chat_count": count_nonempty_lines(path) if primary else 0,
        "latest_message_sender": preview["sender"],
        "latest_message_preview": preview["text"],
    }


def collect_repo_sessions(runtime: Any) -> tuple[list[dict], str, str]:
    result = runtime.tmux_run(["list-sessions", "-F", "#{session_name}"])
    if result.timed_out:
        return [], "unhealthy", "tmux list-sessions timed out"
    if result.returncode != 0:
        return [], "ok", ""

    sessions: list[dict] = []
    any_timeout = False
    timeout_detail = ""

    for name in result.stdout.splitlines():
        if not name or any_timeout:
            continue

        workspace, t2 = runtime.tmux_env_query(name, "AGENT_WINDOW_WORKSPACE")
        if t2:
            any_timeout, timeout_detail = True, f"tmux show-environment (WORKSPACE) timed out for {name}"
            break
        if not workspace:
            continue
        r_attached = runtime.tmux_run(["display-message", "-p", "-t", name, "#{session_attached}"])
        r_created = runtime.tmux_run(["display-message", "-p", "-t", name, "#{session_created}"])
        r_dead = runtime.tmux_run(["list-panes", "-t", name, "-F", "#{pane_dead}"])
        agents, t5 = runtime.session_agents_query(name)

        if t2 or r_attached.timed_out or r_created.timed_out or r_dead.timed_out or t5:
            any_timeout = True
            timeout_detail = f"tmux query timed out during session scan for {name}"
            break

        attached = r_attached.stdout.strip() or "0"
        created_epoch = r_created.stdout.strip() or "0"
        try:
            created_at = dt.datetime.fromtimestamp(int(created_epoch)).strftime("%Y-%m-%d %H:%M")
        except Exception as exc:
            logging.error(f"Unexpected error: {exc}", exc_info=True)
            created_at = ""

        dead_panes = sum(1 for line in r_dead.stdout.splitlines() if line.strip() == "1")

        if dead_panes > 0:
            status = "degraded"
        elif attached != "0":
            status = "attached"
        else:
            status = "idle"

        sessions.append(
            build_session_record(
                runtime,
                name=name,
                workspace=workspace,
                agents=agents,
                status=status,
                attached=int(attached) if attached.isdigit() else 0,
                dead_panes=dead_panes,
                created_epoch=int(created_epoch) if created_epoch.isdigit() else 0,
                created_at=created_at,
            )
        )

    if any_timeout:
        return sessions, "unhealthy", timeout_detail

    sessions.sort(key=lambda item: item["created_epoch"], reverse=True)
    return sessions, "ok", ""


def archived_sessions(runtime: Any, active_names: set[str] | list[str] | None = None) -> list[dict]:
    active_names_set = set(active_names or [])
    records: dict[str, dict] = {}
    log_roots: list[Path] = []
    for candidate in (runtime.central_log_dir,):
        if not candidate or not Path(candidate).is_dir():
            continue
        root = Path(candidate)
        if root not in log_roots:
            log_roots.append(root)
    if not log_roots:
        return []
    for log_root in log_roots:
        entries = [entry for entry in log_root.iterdir() if entry.is_dir()]
        for entry in entries:
            meta_path = entry / ".meta"
            log_path = entry / ".log.jsonl"
            try:
                if not meta_path.exists() and not log_path.exists():
                    continue
            except OSError:
                continue
            meta: dict[str, Any] = {}
            if meta_path.exists():
                try:
                    raw_meta = meta_path.read_text(encoding="utf-8")
                    meta = json.loads(raw_meta)
                except json.JSONDecodeError:
                    try:
                        meta, _ = json.JSONDecoder().raw_decode(raw_meta)
                    except Exception:
                        meta = {}
                except (OSError, FileNotFoundError):
                    meta = {}
                except Exception as exc:
                    logging.error(f"Unexpected error: {exc}", exc_info=True)
                    meta = {}
            session_name = (meta.get("session") or parse_session_dir(entry.name) or "").strip()
            if not session_name or session_name in active_names_set:
                continue
            workspace = (meta.get("workspace") or "").strip() or str(runtime.repo_root)
            created_epoch = parse_saved_time(str(meta.get("created_at", "")))
            updated_epoch = parse_saved_time(str(meta.get("updated_at", "")))
            if not updated_epoch:
                updated_epoch = created_epoch
            if not created_epoch:
                created_epoch = updated_epoch
            agents: list[str] = []
            seen_agents: set[str] = set()
            meta_agents = meta.get("agents")
            if isinstance(meta_agents, list) and meta_agents:
                for a in meta_agents:
                    name = str(a).strip()
                    if name and name not in seen_agents:
                        seen_agents.add(name)
                        agents.append(name)
            record = build_session_record(
                runtime,
                name=session_name,
                workspace=workspace,
                agents=agents,
                status="archived",
                attached=0,
                dead_panes=0,
                created_epoch=int(created_epoch or 0),
                created_at=str(meta.get("created_at") or format_epoch(created_epoch)),
                updated_epoch=int(updated_epoch or 0),
                updated_at=str(meta.get("updated_at") or format_epoch(updated_epoch)),
                log_path=log_path,
            )
            existing = records.get(session_name)
            if existing is None or record["updated_epoch"] > existing["updated_epoch"]:
                records[session_name] = record
    sessions = list(records.values())
    sessions.sort(key=lambda item: item["updated_epoch"], reverse=True)
    return sessions
