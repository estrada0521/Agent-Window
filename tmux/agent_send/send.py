from __future__ import annotations

import http.client
import json
import sys
import time
from pathlib import Path
from agents import agent_base_name
from agents.registry import ALL_AGENT_NAMES
from fs.log.jsonl import append_jsonl_entry
from fs.log.meta import find_timeline_name_for_workspace
from tmux.session import AgentPane, agent_topology, terminal_window_pane_id
from tmux import TMUX_SOCKET_NAME, run_tmux
from tmux.send_keys import deliver_text_to_pane
from fs.log.paths import log_jsonl_path, workspace_timeline_path


class AgentSender:
    def __init__(self, env: dict[str, str]) -> None:
        tmux_context = (env.get("TMUX") or "").strip()
        if not tmux_context:
            raise RuntimeError("agent-send must run inside an active tmux pane.")
        if Path(tmux_context.split(",", 1)[0]).name != TMUX_SOCKET_NAME:
            raise RuntimeError("agent-send must run inside an Agent Window tmux pane.")
        self.pane_id = (env.get("TMUX_PANE") or "").strip()
        if not self.pane_id:
            raise RuntimeError("TMUX_PANE is not set in this pane.")
        result = run_tmux(["display-message", "-p", "-t", self.pane_id, "#{session_name}\t#{session_path}"])
        self.session_name, _, self.workspace = result.stdout.strip().partition("\t")
        if result.returncode != 0 or not self.session_name or not self.workspace:
            detail = (result.stderr or result.stdout or "").strip()
            raise RuntimeError(detail or "Cannot resolve the current tmux session.")

    def resolve_timeline_name(self) -> str:
        resolved = find_timeline_name_for_workspace(self.workspace)
        if resolved:
            return resolved
        raise RuntimeError("No active Agent Window timeline found for this workspace.")

    def terminal_pane_id(self) -> str:
        pane_id = terminal_window_pane_id(self.session_name)
        if not pane_id:
            raise RuntimeError("Terminal pane not found.")
        return pane_id

    def interrupt_terminal(self) -> None:
        pane_id = self.terminal_pane_id()
        state = run_tmux(["display-message", "-p", "-t", pane_id, "#{pane_dead}"])
        if state.returncode != 0:
            raise RuntimeError(state.stderr.strip() or "Cannot read terminal pane state.")
        if state.stdout.strip() == "1":
            raise RuntimeError("Terminal pane is dead.")
        result = run_tmux(["send-keys", "-t", pane_id, "C-c"])
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "Failed to deliver C-c to terminal.")
        print("Sent C-c to terminal.")

    def send_message(self, target_spec: str, payload: str) -> bool:
        if any(target.strip().lower() == "terminal" for target in target_spec.split(",")):
            if target_spec.strip().lower() != "terminal":
                raise RuntimeError("terminal must be the only target")
            error = deliver_text_to_pane(run_tmux, self.terminal_pane_id(), payload)
            if error:
                raise RuntimeError(f"terminal: {error}")
            print("Sent to terminal.")
            return True

        timeline_name = self.resolve_timeline_name()
        topology = agent_topology(self.session_name)
        sender = next((pane.name for pane in topology if pane.pane_id == self.pane_id), None)
        if not sender:
            raise RuntimeError("Cannot resolve current sender.")
        delivery_payload = sender_payload(sender, payload)
        panes_by_target = delivery_panes(target_spec, sender, topology)
        if not panes_by_target:
            raise RuntimeError("No target panes resolved.")
        if sender in panes_by_target:
            raise RuntimeError("cannot send to yourself")

        delivered: list[str] = []
        for agent, pane_id in panes_by_target.items():
            try:
                error = deliver_text_to_pane(run_tmux, pane_id, delivery_payload)
            except Exception as exc:
                error = str(exc)
            if error:
                print(f"{agent}: {error}", file=sys.stderr)
            else:
                delivered.append(agent)
        if not delivered:
            raise RuntimeError("Message delivery failed for all targets.")

        log_path = log_jsonl_path(timeline_name)
        if not log_path.is_file():
            raise RuntimeError(f"log is unavailable: {log_path}")
        append_jsonl_entry(
            log_path,
            {
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "sender": sender,
                "targets": delivered,
                "message": delivery_payload,
            },
        )
        try:
            notify_delivered_agents(delivered, self.workspace)
        except (OSError, http.client.HTTPException, RuntimeError) as exc:
            print(f"Delivered, but Agent Window was not notified: {exc}", file=sys.stderr)

        display = delivery_payload if len(delivery_payload) <= 200 else delivery_payload[:200] + "..."
        print(f"The following was sent to {', '.join(delivered)}:\n{display}")
        return len(delivered) == len(panes_by_target)


def delivery_panes(target_spec: str, sender: str, topology: list[AgentPane]) -> dict[str, str]:
    panes_by_name = {pane.name: pane.pane_id for pane in topology}
    panes_by_target: dict[str, str] = {}
    for raw_target in [item.strip() for item in target_spec.split(",") if item.strip()]:
        if raw_target.lower() == "others":
            panes_by_target.update((name, pane_id) for name, pane_id in panes_by_name.items() if name != sender)
            continue
        name = resolve_agent_instance(raw_target, list(panes_by_name))
        panes_by_target[name] = panes_by_name[name]
    return panes_by_target


def resolve_agent_instance(requested: str, available: list[str]) -> str:
    lowered = requested.lower()
    for instance in available:
        if instance.lower() == lowered:
            return instance
    base = agent_base_name(lowered)
    if base in ALL_AGENT_NAMES:
        candidates = [instance for instance in available if instance == base or instance.startswith(f"{base}-")]
        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) > 1:
            raise RuntimeError(f'Agent target "{requested}" is ambiguous; use one of: {", ".join(candidates)}')
    raise RuntimeError(f"Agent instance not found: {requested}")


def notify_delivered_agents(agents: list[str], workspace: str) -> None:
    port = int((Path(__file__).resolve().parents[2] / "server/hub/port").read_text())
    body = json.dumps({"targets": agents}).encode("utf-8")
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
    try:
        connection.request(
            "POST",
            workspace_timeline_path(workspace) + "/agents-delivered",
            body=body,
            headers={"Content-Type": "application/json", "Content-Length": str(len(body))},
        )
        response = connection.getresponse()
        detail = response.read().decode("utf-8", errors="replace").strip()
        if not 200 <= response.status < 300:
            raise RuntimeError(detail or f"Hub returned {response.status}")
    finally:
        connection.close()


def sender_payload(sender: str, payload: str) -> str:
    body = payload[1:] if payload.startswith("\n") else payload
    return f"[From: {sender}]\n{body}\n"
