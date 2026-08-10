from __future__ import annotations

import re


def agent_base_name(raw_name: str) -> str:
    return re.sub(r"-\d+$", "", str(raw_name or "").strip().lower())
