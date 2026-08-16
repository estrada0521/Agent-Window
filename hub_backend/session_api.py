from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from backend_core.access.settings import local_runtime_log_dir, session_log_path


@dataclass(frozen=True)
class HubSessionApiContext:
    repo_root: Path
    hub: object
    active_session_records_query: Callable
    archived_session_records: Callable
    ensure_chat_server: Callable
    delete_archived_session: Callable


class HubSessionApi:
    def __init__(self, ctx: HubSessionApiContext):
        self.ctx = ctx

    def session_logs_dir(self, session_name: str) -> Path:
        return local_runtime_log_dir(self.ctx.repo_root) / str(session_name or "").strip()

    def read_json_file(self, path: Path) -> dict:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"invalid json object: {path}")
        return data

    def resolve_session_chat_target(self, session_name: str) -> dict:
        query = self.ctx.active_session_records_query()
        if session_name in query.records:
            ok, chat_port, detail = self.ctx.ensure_chat_server(session_name)
            if not ok:
                return {"status": "error", "detail": detail}
            return {
                "status": "ok",
                "chat_port": chat_port,
                "session_record": query.records.get(session_name, {}),
            }
        if query.state == "unhealthy":
            return {"status": "unhealthy", "detail": query.detail}
        archived = self.ctx.archived_session_records(query.records.keys())
        record = archived.get(session_name)
        if not record:
            return {"status": "missing"}
        workspace = str(record.get("workspace") or "").strip()
        if not workspace or not Path(workspace).is_dir():
            return {"status": "error", "detail": f"Saved workspace is unavailable: {workspace or 'unknown'}"}
        ok, chat_port, detail = self.ctx.ensure_chat_server(
            session_name,
            session_is_active=False,
            workspace=workspace,
        )
        if not ok:
            return {"status": "error", "detail": detail}
        return {
            "status": "ok",
            "chat_port": chat_port,
            "session_record": record,
        }

    def format_session_timestamp(self, epoch: int | None = None) -> str:
        ts = int(epoch or time.time())
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))

    def unique_session_name_for_workspace(self, workspace: str) -> str:
        raw_name = Path(workspace).name or "session"
        base = re.sub(r"[^a-zA-Z0-9_.\-]", "-", raw_name).strip(".-")[:64] or "session"
        query = self.ctx.active_session_records_query()
        existing = set(query.records.keys())
        existing.update(self.ctx.archived_session_records(existing).keys())
        candidate = base
        suffix = 2
        while candidate in existing or self.session_logs_dir(candidate).exists():
            suffix_text = f"-{suffix}"
            candidate = f"{base[:max(1, 64 - len(suffix_text))]}{suffix_text}"
            suffix += 1
        return candidate

    def write_session_metadata(self, session_name: str, workspace: str) -> dict:
        """Write .meta and ensure .log.jsonl exists."""
        session_dir = self.session_logs_dir(session_name)
        session_dir.mkdir(parents=True, exist_ok=True)
        log_path = session_log_path(session_name)
        log_path.touch(exist_ok=True)
        meta_path = session_dir / ".meta"
        existing_meta = self.read_json_file(meta_path) if meta_path.is_file() else {}
        created_at = str(existing_meta.get("created_at") or "").strip() or self.format_session_timestamp()
        updated_at = self.format_session_timestamp()
        meta_payload = {
            "session": session_name,
            "workspace": workspace,
            "agents": [],
            "created_at": created_at,
            "updated_at": updated_at,
        }
        meta_path.write_text(json.dumps(meta_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return {
            "session_dir": session_dir,
            "log_path": log_path,
            "created_at": created_at,
            "updated_at": updated_at,
        }

    def build_active_session_record(
        self,
        session_name: str,
        workspace: str,
        *,
        created_at: str = "",
        updated_at: str = "",
    ) -> dict:
        """Build a minimal session record for a newly-started active session."""
        log_path = session_log_path(session_name)
        now_epoch = int(time.time())
        record = self.ctx.hub._build_session_record(
            name=session_name,
            workspace=workspace,
            agents=[],
            status="idle",
            attached=0,
            dead_panes=0,
            created_epoch=now_epoch,
            created_at=created_at or self.format_session_timestamp(now_epoch),
            updated_epoch=now_epoch,
            updated_at=updated_at or self.format_session_timestamp(now_epoch),
            log_path=log_path,
        )
        record["running_agents"] = []
        record["is_running"] = True
        return record

    def running_agents_from_session_state(self, session_state: dict | None) -> list[str]:
        if not isinstance(session_state, dict):
            return []
        statuses = session_state.get("statuses")
        if not isinstance(statuses, dict):
            return []
        running: list[str] = []
        for agent, status in statuses.items():
            agent_name = str(agent or "").strip()
            if not agent_name:
                continue
            if str(status or "").strip().lower() == "running":
                running.append(agent_name)
        return running

    def ensure_active_chat_server(self, session_name: str, workspace: str) -> tuple[bool, int, str]:
        return self.ctx.ensure_chat_server(
            session_name,
            session_is_active=True,
            workspace=workspace,
        )
