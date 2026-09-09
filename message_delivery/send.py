from __future__ import annotations

import http.client
import json
import os
import re
import ssl
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from message_delivery.interaction import normalize_sender_payload
from backend_core.agents.names import agent_base_name
from backend_core.agents.registry import ALL_AGENT_NAMES
from backend_core.access.files import append_jsonl_entry
from backend_core.access.session_meta import SessionMetaError, find_session_for_workspace
from backend_core.tmux.session import AgentPane, parse_agent_topology
from backend_core.tmux.topology import default_tmux_socket_name
from message_delivery.paste import deliver_text_to_pane


from backend_core.access.settings import pwa_https_enabled, session_log_path, workspace_chat_port


class AgentSendError(RuntimeError):
    pass


@dataclass(frozen=True)
class DeliveryTarget:
    agent_name: str
    pane_id: str


def tmux_socket_from_env(env: dict[str, str]) -> str:
    explicit = (env.get("AGENT_WINDOW_TMUX_SOCKET") or "").strip()
    if explicit:
        return explicit
    tmux_env = (env.get("TMUX") or "").strip()
    if tmux_env:
        socket_path = tmux_env.split(",", 1)[0]
        if re.match(r"^/(private/)?tmp/tmux-[^/]+/.+$", socket_path):
            return Path(socket_path).name
        return socket_path
    return default_tmux_socket_name()

class TmuxClient:
    def __init__(self, tmux_socket_name: str, env: dict[str, str]):
        self.tmux_socket_name = tmux_socket_name
        self.env = env

    def _prefix(self) -> list[str]:
        if "/" in self.tmux_socket_name:
            return ["tmux", "-S", self.tmux_socket_name]
        return ["tmux", "-L", self.tmux_socket_name]

    def run(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        cmd = [*self._prefix(), *args]
        try:
            return subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                env=self.env,
            )
        except OSError as exc:
            return subprocess.CompletedProcess(cmd, 127, "", str(exc))


class AgentSendRuntime:
    def __init__(
        self,
        *,
        env: dict[str, str] | None = None,
    ) -> None:
        self.env = dict(os.environ if env is None else env)
        tmux_context = (self.env.get("TMUX") or "").strip()
        if not tmux_context:
            raise AgentSendError("agent-send must run inside an active tmux pane.")
        self.tmux_socket_name = tmux_context.split(",", 1)[0]
        self.tmux = TmuxClient(self.tmux_socket_name, self.env)
        self.all_agents = list(ALL_AGENT_NAMES)
        self._tmux_session_name: str | None = None

    def resolve_tmux_session_name(self) -> str:
        """Return the tmux session containing this process's own pane."""
        if self._tmux_session_name is not None:
            return self._tmux_session_name
        result = self.tmux.run(["display-message", "-p", "#{session_name}"])
        resolved = (result.stdout or "").strip()
        if not resolved:
            detail = (result.stderr or result.stdout or "").strip()
            raise AgentSendError(detail or "Cannot resolve the current tmux session.")
        self._tmux_session_name = resolved
        return resolved

    def session_workspace(self) -> str:
        result = self.tmux.run(
            ["display-message", "-p", "-t", self.resolve_tmux_session_name(), "#{session_path}"]
        )
        workspace = (result.stdout or "").strip()
        if result.returncode != 0 or not workspace:
            detail = (result.stderr or result.stdout or "").strip()
            raise AgentSendError(detail or "Cannot resolve the current tmux session workspace.")
        return workspace

    def agent_topology(self) -> list[AgentPane]:
        result = self.tmux.run(
            [
                "list-windows",
                "-t",
                self.resolve_tmux_session_name(),
                "-F",
                "#{window_name}\t#{window_panes}\t#{pane_id}",
            ]
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()
            raise AgentSendError(detail or "Cannot read the current tmux topology.")
        try:
            return parse_agent_topology(result.stdout)
        except RuntimeError as exc:
            raise AgentSendError(str(exc)) from exc

    def resolve_session_name(self, workspace: str | None = None) -> str:
        """Return the current AW session name -- looked up by workspace.

        tmux never carries this (an AW session's name can be renamed
        independently of the tmux session underneath it), so the only
        reliable source is the same one the rest of AW uses: which log
        folder's .meta currently claims this workspace. The workspace itself
        comes from tmux's native session working directory.
        """
        workspace = (workspace or self.session_workspace()).strip()
        try:
            resolved = find_session_for_workspace(workspace)
        except SessionMetaError as exc:
            raise AgentSendError(str(exc)) from exc
        if resolved:
            return resolved
        raise AgentSendError("No active agent-window session found for this workspace.")

    def resolve_agent_name(self, token: str) -> str | None:
        lower = (token or "").strip().lower()
        if not lower:
            return None
        base = agent_base_name(lower)
        if base in self.all_agents:
            return lower
        return None

    def resolve_self_agent(self, topology: list[AgentPane] | None = None) -> str | None:
        current_pane = (self.env.get("TMUX_PANE") or "").strip()
        if not current_pane:
            raise AgentSendError("TMUX_PANE is not set in this pane.")
        for pane in topology if topology is not None else self.agent_topology():
            if pane.pane_id == current_pane:
                return pane.name
        return None

    def active_agent_instances(self, topology: list[AgentPane] | None = None) -> list[str]:
        current = topology if topology is not None else self.agent_topology()
        return [pane.name for pane in current]

    def resolve_agent_name_target(self, requested: str, available: list[str] | None = None) -> str:
        raw = str(requested or "").strip()
        lowered = raw.lower()
        if not lowered:
            raise AgentSendError("Agent target is required.")

        available = available if available is not None else self.active_agent_instances()
        for instance in available:
            if instance.lower() == lowered:
                return instance

        resolved = self.resolve_agent_name(raw)
        if resolved:
            base = agent_base_name(resolved)
            candidates = [
                instance
                for instance in available
                if instance == base or instance.startswith(f"{base}-")
            ]
            if len(candidates) == 1:
                return candidates[0]
            if len(candidates) > 1:
                options = ", ".join(candidates)
                raise AgentSendError(f'Agent target "{raw}" is ambiguous; use one of: {options}')

        raise AgentSendError(f"Agent instance not found: {raw}")

    @staticmethod
    def normalize_payload(sender: str, payload: str) -> str:
        return normalize_sender_payload(sender, payload)

    def resolve_session_log_path(self, session_name: str) -> Path:
        target_session = session_name or "default"
        default_path = session_log_path(target_session)
        default_path.parent.mkdir(parents=True, exist_ok=True)
        if not default_path.exists():
            default_path.touch()
        return default_path

    def _build_delivery_targets(
        self,
        target_spec: str,
        sender_role: str | None,
        topology: list[AgentPane],
    ) -> list[DeliveryTarget]:
        targets: list[DeliveryTarget] = []
        panes_by_target: dict[str, str] = {}
        panes_by_name = {pane.name: pane.pane_id for pane in topology}
        active = list(panes_by_name)

        def queue(agent_name: str, pane_id: str) -> None:
            if not agent_name or not pane_id:
                return
            panes_by_target[agent_name] = pane_id

        for raw_target in [item.strip() for item in (target_spec or "").split(",") if item.strip()]:
            lower_target = raw_target.lower()
            if lower_target == "user":
                raise AgentSendError(
                    'agent-send: target "user" has been removed.\n\n'
                    "Respond to humans in your normal assistant output (native event logs are indexed automatically).\n"
                    "Use agent-send only for agent-to-agent communication targets."
                )
            if lower_target == "others":
                if not sender_role:
                    raise AgentSendError("Cannot resolve current sender for target: others")
                for instance in active:
                    if sender_role != "user" and instance == sender_role:
                        continue
                    queue(instance, panes_by_name[instance])
                continue

            canonical = self.resolve_agent_name_target(raw_target, active)
            pane = panes_by_name.get(canonical, "")
            if not pane:
                raise AgentSendError(f"Target pane not found: {raw_target}")
            queue(canonical, pane)

        for name, pane in panes_by_target.items():
            targets.append(DeliveryTarget(agent_name=name, pane_id=pane))
        return targets

    def _notify_running_agents(self, agents: list[str], workspace: str) -> None:
        port = workspace_chat_port(workspace)
        body = json.dumps({"targets": agents}).encode("utf-8")
        connection: http.client.HTTPConnection | http.client.HTTPSConnection
        if pwa_https_enabled():
            connection = http.client.HTTPSConnection(
                "127.0.0.1",
                port,
                timeout=1,
                context=ssl._create_unverified_context(),
            )
        else:
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
        try:
            connection.request(
                "POST",
                "/agent-running",
                body=body,
                headers={
                    "Content-Type": "application/json",
                    "Content-Length": str(len(body)),
                    "Host": f"127.0.0.1:{port}",
                },
            )
            response = connection.getresponse()
            detail = response.read().decode("utf-8", errors="replace").strip()
            if not 200 <= response.status < 300:
                raise AgentSendError(detail or f"chat server returned {response.status}")
        except (OSError, http.client.HTTPException, TimeoutError) as exc:
            raise AgentSendError(f"could not notify chat server: {exc}") from exc
        finally:
            connection.close()

    def send_to_pane(
        self,
        pane_id: str,
        payload: str,
    ) -> bool:
        return deliver_text_to_pane(self.tmux.run, pane_id, payload, env=self.env)

    def append_log_entry(
        self,
        *,
        session_name: str,
        sender: str,
        targets: list[str],
        payload: str,
    ) -> None:
        log_path = self.resolve_session_log_path(session_name)
        entry = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "session": session_name,
            "sender": sender,
            "targets": targets,
            "message": payload,
        }
        append_jsonl_entry(log_path, entry)

    def send_message(
        self,
        *,
        target_spec: str,
        payload: str,
    ) -> bool:
        workspace = self.session_workspace()
        session_name = self.resolve_session_name(workspace)
        topology = self.agent_topology()
        sender_role = self.resolve_self_agent(topology) or "user"
        delivery_payload = self.normalize_payload(sender_role, payload)
        delivery_targets = self._build_delivery_targets(target_spec, sender_role, topology)
        if not delivery_targets:
            raise AgentSendError("No target panes resolved.")

        if any(t.agent_name == sender_role for t in delivery_targets):
            raise AgentSendError("cannot send to yourself")

        successful_targets: list[str] = []
        failed_any = False
        for target in delivery_targets:
            if self.send_to_pane(target.pane_id, delivery_payload):
                if target.agent_name not in successful_targets:
                    successful_targets.append(target.agent_name)
            else:
                failed_any = True
                print(f"Failed to deliver to: {target.agent_name}", file=sys.stderr)

        if not successful_targets:
            raise AgentSendError("Message delivery failed for all targets.")

        self.append_log_entry(
            session_name=session_name,
            sender=sender_role,
            targets=successful_targets,
            payload=delivery_payload,
        )
        try:
            self._notify_running_agents(successful_targets, workspace)
        except AgentSendError as exc:
            print(f"Delivered, but Agent Window was not notified: {exc}", file=sys.stderr)

        target_names = ", ".join(successful_targets)
        display = delivery_payload if len(delivery_payload) <= 200 else delivery_payload[:200] + "..."
        print(f"The following was sent to {target_names}:\n{display}")

        return not failed_any
