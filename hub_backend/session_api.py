from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

from backend_core.access.settings import session_log_path


@dataclass(frozen=True)
class HubSessionApiContext:
    hub: object
    active_session_records_query: Callable
    archived_session_records: Callable
    ensure_chat_server: Callable


class HubSessionApi:
    def __init__(self, ctx: HubSessionApiContext):
        self.ctx = ctx

    def resolve_session_chat_target(self, session_name: str) -> dict:
        query = self.ctx.active_session_records_query()
        if session_name in query.records:
            workspace = str((query.records.get(session_name) or {}).get("workspace") or "").strip()
            ok, chat_port, detail = self.ctx.ensure_chat_server(
                expected_active=True,
                workspace=workspace,
            )
            if not ok:
                return {"status": "error", "detail": detail}
            return {
                "status": "ok",
                "chat_port": chat_port,
                "session_record": query.records.get(session_name, {}),
                "session_is_active": True,
            }
        if query.state == "unhealthy":
            return {"status": "unhealthy", "detail": query.detail}
        archived = self.ctx.archived_session_records(query.non_archived_names)
        record = archived.get(session_name)
        if not record:
            return {"status": "missing"}
        workspace = str(record.get("workspace") or "").strip()
        ok, chat_port, detail = self.ctx.ensure_chat_server(
            expected_active=False,
            workspace=workspace,
        )
        if not ok:
            return {"status": "error", "detail": detail}
        return {
            "status": "ok",
            "chat_port": chat_port,
            "session_record": record,
            "session_is_active": False,
        }

    def format_session_timestamp(self, epoch: int | None = None) -> str:
        ts = int(epoch or time.time())
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))

    def build_active_session_record(
        self,
        session_name: str,
        workspace: str,
    ) -> dict:
        """Build a minimal session record for a newly-started active session."""
        log_path = session_log_path(session_name)
        now_epoch = int(time.time())
        now = self.format_session_timestamp(now_epoch)
        record = self.ctx.hub._build_session_record(
            name=session_name,
            workspace=workspace,
            agents=[],
            status="idle",
            attached=0,
            dead_panes=0,
            created_epoch=now_epoch,
            created_at=now,
            updated_epoch=now_epoch,
            updated_at=now,
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

    def ensure_active_chat_server(self, workspace: str) -> tuple[bool, int, str]:
        return self.ctx.ensure_chat_server(
            expected_active=True,
            workspace=workspace,
        )
