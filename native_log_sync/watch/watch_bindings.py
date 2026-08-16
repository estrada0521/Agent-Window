from __future__ import annotations

import os
import select
import sys
import threading

from native_log_sync.watch.emit_events import emit_agent_updates


class _VnodeNativeSync:
    def __init__(self, runtime) -> None:
        self._runtime = runtime
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
        bindings: dict = dict(getattr(self._runtime, "_native_log_bindings_by_agent", {}))
        with self._lock:
            for agent in list(self._fd_by_agent):
                if agent not in bindings:
                    self._close_locked(agent)
            for agent, binding in bindings.items():
                if self._path_by_agent.get(agent) != binding.path:
                    if agent in self._fd_by_agent:
                        self._close_locked(agent)
                    self._open_locked(agent, binding.path)

    def _close_locked(self, agent: str) -> None:
        fd = self._fd_by_agent.pop(agent, None)
        self._path_by_agent.pop(agent, None)
        if fd is not None:
            self._agent_by_fd.pop(fd, None)
            os.close(fd)

    def _open_locked(self, agent: str, path: str) -> None:
        try:
            fd = os.open(path, os.O_RDONLY)
        except FileNotFoundError:
            return
        ev = select.kevent(
            fd,
            filter=select.KQ_FILTER_VNODE,
            flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR,
            fflags=select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND,
        )
        self._kq.control([ev], 0)
        self._fd_by_agent[agent] = fd
        self._path_by_agent[agent] = path
        self._agent_by_fd[fd] = agent

    def get_watched_paths(self) -> dict[str, str]:
        with self._lock:
            return dict(self._path_by_agent)

    def run(self) -> None:
        reconfigure = getattr(self._runtime, "_native_log_watch_reconfigure", None)
        self._sync_bindings()
        if reconfigure:
            reconfigure.clear()
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
            if woke or (reconfigure and reconfigure.is_set()):
                if reconfigure:
                    reconfigure.clear()
                self._sync_bindings()
            if not self._runtime.session_is_active:
                continue
            for event in pending:
                if event.fflags & (select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND):
                    with self._lock:
                        agent = self._agent_by_fd.get(event.ident)
                        path = self._path_by_agent.get(agent) if agent else None
                    if agent and path:
                        emit_agent_updates(self._runtime, agent, path)


def start_native_log_vnode_watcher(runtime) -> None:
    if sys.platform != "darwin":
        return
    watcher = _VnodeNativeSync(runtime)
    runtime._native_log_vnode_watcher = watcher
    threading.Thread(target=watcher.run, daemon=True, name="native-vnode").start()
