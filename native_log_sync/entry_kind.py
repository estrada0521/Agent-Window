from __future__ import annotations

import json
import re

_GEMINI_PLAN_PREFIX = re.compile(
    r"^\s*(?:✦\s*)?(?:i\s+will|i['’]ll|i\s+am\s+going\s+to|let\s+me)\b",
    re.IGNORECASE,
)
_MAX_PLAN_TEXT_LEN = 280
_LEGACY_EPHEMERAL_KIND = "agent-thinking"
_ANTIGRAVITY_TOOL_KEYS = {
    "functionCall",
    "toolAction",
    "toolCallId",
    "toolInput",
    "toolName",
    "toolResult",
    "toolSummary",
    "toolUseId",
}
_ANTIGRAVITY_THOUGHT_PHRASES = (
    "okay,",
    "i'm ",
    "i've ",
    "i am ",
    "i need ",
    "my focus ",
)
_ANTIGRAVITY_TOOL_NAMES = {
    "command_status",
    "define_subagent",
    "find_by_name",
    "grep_search",
    "invoke_subagent",
    "list_dir",
    "manage_task",
    "multi_replace_file_content",
    "read_file",
    "replace",
    "replace_file_content",
    "run_command",
    "run_shell_command",
    "search_web",
    "send_message",
    "view_file",
    "write_to_file",
    "write_file",
}
_ANTIGRAVITY_INTERNAL_DIGEST = re.compile(r"\d+\([0-9a-fA-F]{32,64}\)?")
_ANTIGRAVITY_INTERNAL_BOT_REF = re.compile(r"\d+\(bot-[0-9a-fA-F-]{8,36}\)?")
_ANTIGRAVITY_HEX_DIGEST = re.compile(r"(?=.*[a-fA-F])[0-9a-fA-F]{32,64}")
_ANTIGRAVITY_BASE64_BLOB = re.compile(r"[A-Za-z0-9+/]{120,}={0,2}")


def _normalized_nonempty_texts(texts: list[str]) -> list[str]:
    return [str(text or "").strip() for text in texts if str(text or "").strip()]


def _is_planning_style_text(text: str) -> bool:
    body = str(text or "").strip()
    if not body or len(body) > _MAX_PLAN_TEXT_LEN:
        return False
    first_line = body.splitlines()[0].strip()
    if not first_line:
        return False
    return bool(_GEMINI_PLAN_PREFIX.match(first_line))


def _has_gemini_plan_prefix(text: str) -> bool:
    body = str(text or "").strip()
    if not body:
        return False
    first_line = body.splitlines()[0].strip()
    if not first_line:
        return False
    return bool(_GEMINI_PLAN_PREFIX.match(first_line))


def strip_sender_prefix(message: str) -> str:
    text = str(message or "").replace("\r\n", "\n").strip()
    if text.startswith("[From:"):
        close = text.find("]")
        if close != -1:
            text = text[close + 1 :].lstrip()
    return text


def is_ephemeral_thought_content(texts: list[str], *, has_thought_part: bool = False) -> bool:
    if has_thought_part:
        return True
    normalized = _normalized_nonempty_texts(texts)
    if not normalized:
        return False
    return _has_gemini_plan_prefix(" ".join(normalized))


def is_antigravity_tool_call_text(text: str) -> bool:
    body = str(text or "").strip()
    if not body.startswith("{") or not body.endswith("}"):
        return False
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return False
    if not isinstance(payload, dict):
        return False
    return bool(_ANTIGRAVITY_TOOL_KEYS.intersection(payload))


def is_antigravity_internal_text(text: str) -> bool:
    body = str(text or "").strip()
    if not body:
        return True
    if any(ord(ch) < 32 and ch not in "\n\r\t" for ch in body):
        return True
    if body.startswith(("sessionID", "file://", "command(", "read_url(")):
        return True
    if body.startswith(("/", "MODEL_", "gemini-")):
        return True
    if body in _ANTIGRAVITY_TOOL_NAMES:
        return True
    if "trajectory_id" in body:
        return True
    if _ANTIGRAVITY_INTERNAL_DIGEST.fullmatch(body):
        return True
    if _ANTIGRAVITY_INTERNAL_BOT_REF.fullmatch(body):
        return True
    if _ANTIGRAVITY_HEX_DIGEST.fullmatch(body):
        return True
    if _ANTIGRAVITY_BASE64_BLOB.fullmatch(body):
        return True
    if re.fullmatch(r"-?\d{12,}", body):
        return True
    if re.fullmatch(r"bot-[0-9a-fA-F-]{36}", body):
        return True
    if 6 <= len(body) <= 12 and re.fullmatch(r"[a-z0-9]+", body) and re.search(r"\d", body):
        return True
    if (
        16 <= len(body) <= 80
        and not re.search(r"\s", body)
        and re.fullmatch(r"[A-Za-z0-9_-]+", body)
        and re.search(r"[a-z]", body)
        and re.search(r"[A-Z]", body)
        and re.search(r"\d", body)
    ):
        return True
    if len(body) == 36 and body.count("-") == 4:
        return True
    return False


def is_antigravity_thought_trace_text(text: str) -> bool:
    body = strip_sender_prefix(str(text or "")).strip()
    if "**" not in body[:120]:
        return False
    if "**Summary of work:**" in body or "**行ったこと" in body:
        return False
    lower = body[:1200].lower()
    if not any(phrase in lower for phrase in _ANTIGRAVITY_THOUGHT_PHRASES):
        return False
    return bool(re.search(r"(?:^|\n)\*\*[^*\n]{3,80}\*\*|^[^*\n]{3,80}\*\*", body))


def should_omit_antigravity_text(text: str) -> bool:
    return (
        is_antigravity_tool_call_text(text)
        or is_antigravity_internal_text(text)
        or is_antigravity_thought_trace_text(text)
    )


def should_omit_entry_from_chat(entry: dict) -> bool:
    if not isinstance(entry, dict):
        return False
    sender_name = str(entry.get("sender") or "").strip().lower()
    if not sender_name or sender_name in {"user", "system"}:
        return False
    sender_base = re.sub(r"-\d+$", "", sender_name)
    kind = str(entry.get("kind") or "").strip().lower()
    if kind == _LEGACY_EPHEMERAL_KIND:
        return True
    body = strip_sender_prefix(str(entry.get("message") or ""))
    structured_antigravity_response = (
        str(entry.get("native_log_kind") or "").strip().lower()
        == "antigravity_assistant_response"
    )
    if sender_base == "gemini" and not structured_antigravity_response and should_omit_antigravity_text(body):
        return True
    if sender_base == "gemini" and not structured_antigravity_response and _has_gemini_plan_prefix(body):
        return True
    if _is_planning_style_text(body):
        return True
    return False
