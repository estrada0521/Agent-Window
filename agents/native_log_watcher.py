from __future__ import annotations

import os
import select
import threading


class NativeLogWatcher:
    def __init__(self, sync) -> None:
        self._sync = sync
        self._lock = threading.Lock()
        self._kq = select.kqueue()
        self._fd_by_agent: dict[str, int] = {}
        self._path_by_agent: dict[str, str] = {}
        self._agent_by_fd: dict[int, str] = {}
        self._wake_r, self._wake_w = os.pipe()
        os.set_blocking(self._wake_r, False)
        os.set_blocking(self._wake_w, False)
        os.set_inheritable(self._wake_r, False)
        os.set_inheritable(self._wake_w, False)
        self._kq.control(
            [
                select.kevent(
                    self._wake_r,
                    filter=select.KQ_FILTER_READ,
                    flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR,
                )
            ],
            0,
        )

    def wake(self) -> None:
        try:
            os.write(self._wake_w, b"\0")
        except BlockingIOError:
            return

    def _drain_wake(self) -> None:
        while True:
            try:
                chunk = os.read(self._wake_r, 64)
            except BlockingIOError:
                return
            if not chunk:
                return

    def _sync_bindings(self) -> None:
        bindings = self._sync.bindings()
        failed_opens: list[tuple[str, OSError]] = []
        with self._lock:
            for agent in list(self._fd_by_agent):
                if agent not in bindings:
                    self._close_locked(agent)
            for agent, binding in bindings.items():
                if self._path_by_agent.get(agent) != binding.path:
                    if agent in self._fd_by_agent:
                        self._close_locked(agent)
                    try:
                        self._open_locked(agent, binding.path)
                    except OSError as exc:
                        failed_opens.append((agent, exc))
        for agent, exc in failed_opens:
            self._sync.failed(agent, f"watch failed: {exc}")

    def _close_locked(self, agent: str) -> None:
        fd = self._fd_by_agent.pop(agent, None)
        self._path_by_agent.pop(agent, None)
        if fd is not None:
            self._agent_by_fd.pop(fd, None)
            os.close(fd)

    def _open_locked(self, agent: str, path: str) -> None:
        fd = os.open(path, os.O_RDONLY)
        ev = select.kevent(
            fd,
            filter=select.KQ_FILTER_VNODE,
            flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR,
            fflags=select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND | select.KQ_NOTE_DELETE | select.KQ_NOTE_RENAME,
        )
        self._kq.control([ev], 0)
        self._fd_by_agent[agent] = fd
        self._path_by_agent[agent] = path
        self._agent_by_fd[fd] = agent

    def watched_paths(self) -> dict[str, str]:
        with self._lock:
            return dict(self._path_by_agent)

    def run(self) -> None:
        self._sync_bindings()
        while True:
            events = self._kq.control(None, 16, None)
            woke = False
            pending = []
            for event in events:
                if event.ident == self._wake_r:
                    self._drain_wake()
                    woke = True
                    continue
                pending.append(event)
            if woke:
                self._sync_bindings()
            rebind_agents: list[str] = []
            for event in pending:
                if event.fflags & (select.KQ_NOTE_DELETE | select.KQ_NOTE_RENAME):
                    agent = None
                    with self._lock:
                        agent = self._agent_by_fd.get(event.ident)
                        if agent:
                            self._close_locked(agent)
                    if agent:
                        rebind_agents.append(agent)
                    continue
                if event.fflags & (select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND):
                    with self._lock:
                        agent = self._agent_by_fd.get(event.ident)
                        path = self._path_by_agent.get(agent) if agent else None
                    if agent and path:
                        try:
                            self._sync.sync(agent, path)
                        except Exception as exc:
                            self._sync.failed(agent, f"sync failed: {exc}")
            if rebind_agents:
                seen: set[str] = set()
                for agent in rebind_agents:
                    if agent in seen:
                        continue
                    seen.add(agent)
                    try:
                        self._sync.rebind(agent)
                    except Exception as exc:
                        self._sync.failed(agent, f"rebind failed: {exc}")
                self._sync_bindings()

