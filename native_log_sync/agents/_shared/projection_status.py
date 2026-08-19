from __future__ import annotations

import logging


def record_projection_scan_result(runtime: object, agent: str, scan) -> None:
    """Reflect a completed jsonl scan's skipped-line count into projection status.

    A skipped line means the CLI's own native log had a line we couldn't
    parse; that's the CLI's record to own, not ours to fail on. But it must
    not be silent, so it's logged and kept as the agent's current status.
    """
    if not scan.skipped:
        runtime._native_log_projection_status[agent] = {"status": "ok"}
        return
    detail = (
        f"{scan.skipped} unparsable line(s) skipped, most recent at native "
        f"offset {scan.last_skip_offset} ({scan.last_skip_reason})"
    )
    logging.warning("native log projection warning for %s: %s", agent, detail)
    runtime._native_log_projection_status[agent] = {"status": "warning", "detail": detail}


def record_projection_sync_failure(runtime: object, agent: str, exc: Exception) -> None:
    runtime._native_log_projection_status[agent] = {"status": "unavailable", "detail": str(exc)}
