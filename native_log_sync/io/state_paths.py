"""
Where native log sync persists per-session state on disk.

This package owns the canonical filenames. Files live next to the session
agent-index JSONL only as a deployment anchor (same directory as the hub index);
the format and lifecycle are defined in native_log_sync (see sync_state.py).
"""

from __future__ import annotations

from pathlib import Path

NATIVE_LOG_SYNC_STATE_FILENAME = ".native-log-sync-state.json"

# Internal bookkeeping (native_log_progress / agent_first_seen_ts). Deliberately
# not mirrored into the workspace: it has no value to an agent looking up a
# provider's current native log path via NATIVE_LOG_SYNC_STATE_FILENAME.
NATIVE_LOG_SYNC_INTERNAL_FILENAME = ".native-log-sync-internal.json"


def canonical_native_log_sync_state_path(session_dir: Path | str) -> Path:
    return Path(session_dir).resolve() / NATIVE_LOG_SYNC_STATE_FILENAME


def canonical_native_log_sync_internal_path(session_dir: Path | str) -> Path:
    return Path(session_dir).resolve() / NATIVE_LOG_SYNC_INTERNAL_FILENAME
