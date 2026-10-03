from __future__ import annotations

import gzip
import json
from pathlib import Path
from urllib.parse import parse_qs

from server.appearance.typography import MOBILE_TEXT_SIZE
from fs.log.jsonl import log_slice
from git import repo as workspace_git
from server.request import request_base_path
from server.timeline.file_view import render_file_view
from server.timeline.syntax import add_syntax_highlighting
from server.timeline.state import ENTRY_WINDOW_LIMIT
from server.timeline.slash_commands import public_slash_command_dicts


def _send_bytes(
    handler,
    status: int,
    body: bytes,
    *,
    content_type: str,
    cache_control: str = "no-store",
    extra_headers: dict[str, str] | None = None,
) -> None:
    compressible = len(body) >= 1024 and content_type.startswith(("text/html", "application/json"))
    use_gzip = False
    if compressible:
        for encoding in handler.headers.get("Accept-Encoding", "").split(","):
            name, _, parameters = encoding.strip().partition(";")
            if name.lower() != "gzip":
                continue
            quality = 1.0
            for parameter in parameters.split(";"):
                key, _, value = parameter.strip().partition("=")
                if key.lower() == "q":
                    try:
                        quality = float(value)
                    except ValueError:
                        quality = 0
            use_gzip = quality > 0
        if use_gzip:
            body = gzip.compress(body, compresslevel=1)
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    if compressible:
        handler.send_header("Vary", "Accept-Encoding")
    if use_gzip:
        handler.send_header("Content-Encoding", "gzip")
    if cache_control:
        handler.send_header("Cache-Control", cache_control)
    if extra_headers:
        for key, value in extra_headers.items():
            handler.send_header(key, value)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _get_messages(handler, parsed, ctx) -> None:
    qs = parse_qs(parsed.query)
    body = ctx["payload_fn"](
        limit=min(ENTRY_WINDOW_LIMIT, int(qs.get("limit", [ENTRY_WINDOW_LIMIT])[0])),
        offset=int(qs.get("offset", ["0"])[0]),
    )
    _send_bytes(handler, 200, body, content_type="application/json; charset=utf-8")


DEFAULT_TRACE_TAIL_LINES = 160


def _get_trace(handler, parsed, ctx) -> None:
    qs = parse_qs(parsed.query)
    agent = qs.get("agent", [""])[0].lower()
    tail_raw = (qs.get("lines", [""])[0] or "").strip()
    tail_lines = DEFAULT_TRACE_TAIL_LINES
    if tail_raw:
        try:
            tail_lines = max(1, min(int(tail_raw), 10_000))
        except ValueError:
            pass
    try:
        content_str = ctx["state"].trace_content(agent, tail_lines=tail_lines)
    except Exception as exc:
        body = json.dumps({"error": str(exc)}, ensure_ascii=True).encode("utf-8")
        _send_bytes(handler, 500, body, content_type="application/json; charset=utf-8")
        return
    body = json.dumps({"content": content_str}, ensure_ascii=True).encode("utf-8")
    _send_bytes(handler, 200, body, content_type="application/json; charset=utf-8")


def _get_file_raw(handler, parsed, ctx) -> None:
    qs = parse_qs(parsed.query)
    rel = qs.get("path", [""])[0]
    try:
        metadata = ctx["files"].raw_response_metadata(rel, handler.headers.get("Range", ""))
    except PermissionError:
        handler.send_error(403)
        return
    except FileNotFoundError:
        handler.send_error(404)
        return
    if int(metadata.get("status", 500)) == 416:
        handler.send_response(416)
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Content-Range", f"bytes */{int(metadata.get('size', 0) or 0)}")
        handler.end_headers()
        return
    handler.send_response(int(metadata.get("status", 200)))
    handler.send_header("Content-Type", str(metadata.get("content_type") or "application/octet-stream"))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Accept-Ranges", "bytes")
    content_range = str(metadata.get("content_range") or "")
    if content_range:
        handler.send_header("Content-Range", content_range)
    handler.send_header("Content-Length", str(int(metadata.get("length", 0) or 0)))
    handler.end_headers()
    ctx["files"].stream_raw_response(metadata, handler.wfile.write)


def _get_file_view(handler, parsed, ctx) -> None:
    qs = parse_qs(parsed.query)
    rel = qs.get("path", [""])[0]
    embed = qs.get("embed", [""])[0] == "1"
    force_progressive_text = qs.get("progressive", [""])[0] == "1"
    try:
        preview_text_size = MOBILE_TEXT_SIZE
        requested_text_size = str(qs.get("agent_text_size", [""])[0] or "").strip()
        if requested_text_size:
            try:
                preview_text_size = int(requested_text_size)
            except ValueError:
                pass
        page = render_file_view(
            ctx["files"],
            rel,
            embed=embed,
            base_path=request_base_path(headers=handler.headers, query_string=parsed.query),
            preview_base_theme=str(qs.get("base_theme", [""])[0] or "").strip(),
            agent_text_size=preview_text_size,
            force_progressive_text=force_progressive_text,
        )
    except PermissionError:
        handler.send_error(403)
        return
    except FileNotFoundError:
        handler.send_error(404)
        return
    page = add_syntax_highlighting(page, filename=rel, theme=str(qs.get("base_theme", ["dark"])[0]))
    body = page.encode("utf-8")
    _send_bytes(handler, 200, body, content_type="text/html; charset=utf-8")


def _get_files_dir(handler, parsed, ctx) -> None:
    qs = parse_qs(parsed.query)
    rel = (qs.get("path", [""])[0] or "").strip()
    try:
        entries = ctx["files"].list_dir(rel)
    except PermissionError:
        handler.send_error(403)
        return
    except FileNotFoundError:
        _send_bytes(handler, 404, b'{"error":"Workspace not found"}', content_type="application/json; charset=utf-8")
        return
    except NotADirectoryError:
        _send_bytes(handler, 404, b'{"error":"Directory not found"}', content_type="application/json; charset=utf-8")
        return
    except Exception as exc:
        body = json.dumps({"error": str(exc)}, ensure_ascii=True).encode("utf-8")
        _send_bytes(handler, 500, body, content_type="application/json; charset=utf-8")
        return
    body = json.dumps({"path": rel, "entries": entries}, ensure_ascii=True).encode("utf-8")
    _send_bytes(handler, 200, body, content_type="application/json; charset=utf-8")


def _get_files_search(handler, parsed, ctx) -> None:
    qs = parse_qs(parsed.query)
    query = (qs.get("q", [""])[0] or "").strip()
    limit_raw = (qs.get("limit", [""])[0] or "").strip()
    limit = 60
    if limit_raw:
        try:
            limit = int(limit_raw)
        except ValueError:
            limit = 60
    try:
        files = ctx["files"].search_files(query, limit=limit)
        body = json.dumps(files, ensure_ascii=True).encode("utf-8")
    except Exception as exc:
        body = json.dumps({"error": str(exc)}, ensure_ascii=True).encode("utf-8")
        _send_bytes(handler, 500, body, content_type="application/json; charset=utf-8")
        return
    _send_bytes(handler, 200, body, content_type="application/json; charset=utf-8")


def _get_timeline_state(handler, _parsed, ctx) -> None:
    try:
        body = json.dumps(ctx["state"].timeline_state_payload(), ensure_ascii=True).encode("utf-8")
    except Exception as exc:
        body = json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=True).encode("utf-8")
        _send_bytes(handler, 500, body, content_type="application/json; charset=utf-8")
        return
    _send_bytes(handler, 200, body, content_type="application/json; charset=utf-8")


def _get_events(handler, _parsed, ctx) -> None:
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Connection", "keep-alive")
    handler.end_headers()
    state = ctx["state"]
    seen = state.event_counts()
    try:
        while True:
            events = state.wait_for_events(seen, timeout=15.0)
            body = "".join(
                f"event: git\ndata: {json.dumps(kind.removeprefix('git:'))}\n\n" if kind.startswith("git:")
                else f"event: {kind}\ndata: {json.dumps(data)}\n\n"
                for kind, data in events
            ) or ": keepalive\n\n"
            handler.wfile.write(body.encode("utf-8"))
            handler.wfile.flush()
    except (BrokenPipeError, ConnectionResetError):
        return


def _send_git_json(handler, parsed, ctx, read) -> None:
    qs = parse_qs(parsed.query)
    arg = lambda name: (qs.get(name, [""])[0] or "").strip()
    try:
        body = json.dumps(read(workspace_git.git_tree_root(ctx["workspace"], arg("tree")), arg), ensure_ascii=True).encode("utf-8")
    except LookupError as exc:
        body = json.dumps({"error": str(exc)}, ensure_ascii=True).encode("utf-8")
        _send_bytes(handler, 404, body, content_type="application/json; charset=utf-8")
        return
    except Exception as exc:
        body = json.dumps({"error": str(exc)}, ensure_ascii=True).encode("utf-8")
        _send_bytes(handler, 500, body, content_type="application/json; charset=utf-8")
        return
    _send_bytes(handler, 200, body, content_type="application/json; charset=utf-8")


def _get_git_overview(handler, parsed, ctx) -> None:
    _send_git_json(handler, parsed, ctx, lambda root, arg: workspace_git.git_overview(
        root,
        offset=int(arg("offset") or "0"),
        limit=int(arg("limit") or "50"),
        include_commits=arg("summary").lower() not in ("1", "true", "yes"),
    ))


def _get_git_worktrees(handler, parsed, ctx) -> None:
    def read(_root, _arg):
        trees = workspace_git.git_worktrees(ctx["workspace"])
        linked = sorted(trees[1:], key=lambda tree: (Path(tree["path"]) / ".git").stat().st_birthtime, reverse=True)
        worktrees = [{"path": "", "branch": trees[0]["branch"]}, *linked]
        follow_tree = ctx["state"].last_changed_git_tree()
        return {
            "worktrees": worktrees,
            "followTree": follow_tree if any(tree["path"] == follow_tree for tree in worktrees) else None,
        }
    _send_git_json(handler, parsed, ctx, read)


def _get_log_slice(handler, parsed, ctx) -> None:
    qs = parse_qs(parsed.query)
    try:
        body = log_slice(
            ctx["state"].log_path,
            start_hash=(qs.get("from", [""])[0] or "").strip(),
            end_hash=(qs.get("to", [""])[0] or "").strip(),
        )
    except LookupError as exc:
        body = json.dumps({"error": str(exc)}, ensure_ascii=True).encode("utf-8")
        _send_bytes(handler, 404, body, content_type="application/json; charset=utf-8")
        return
    _send_bytes(handler, 200, body, content_type="application/x-ndjson; charset=utf-8")


def _get_git_diff_files(handler, parsed, ctx) -> None:
    _send_git_json(handler, parsed, ctx, lambda root, arg: workspace_git.git_diff_files(
        root, commit_hash=arg("hash"), scope=arg("scope"),
    ))


def _get_git_file_diff(handler, parsed, ctx) -> None:
    _send_git_json(handler, parsed, ctx, lambda root, arg: workspace_git.git_file_diff(
        root,
        path=arg("path"),
        old_path=arg("old_path"),
        commit_hash=arg("hash"),
        untracked=arg("untracked") == "1",
    ))


def _get_git_commit_info(handler, parsed, ctx) -> None:
    _send_git_json(handler, parsed, ctx, lambda root, arg: workspace_git.git_commit_info(root, commit_hash=arg("hash")))


def _get_git_worktree_stat(handler, parsed, ctx) -> None:
    _send_git_json(handler, parsed, ctx, lambda root, _arg: {"stat": workspace_git.git_worktree_stat(root)})


def _get_slash_commands(handler, _parsed, ctx) -> None:
    del ctx
    body = json.dumps({"commands": public_slash_command_dicts()}, ensure_ascii=True).encode("utf-8")
    _send_bytes(handler, 200, body, content_type="application/json; charset=utf-8")


_GET_ROUTES = {
    "/messages": _get_messages,
    "/log-slice": _get_log_slice,
    "/trace": _get_trace,
    "/file-raw": _get_file_raw,
    "/file-view": _get_file_view,
    "/files-search": _get_files_search,
    "/files-dir": _get_files_dir,
    "/timeline-state": _get_timeline_state,
    "/events": _get_events,
    "/git-overview": _get_git_overview,
    "/git-diff-files": _get_git_diff_files,
    "/git-file-diff": _get_git_file_diff,
    "/git-commit-info": _get_git_commit_info,
    "/git-worktree-stat": _get_git_worktree_stat,
    "/git-worktrees": _get_git_worktrees,
    "/slash-commands": _get_slash_commands,
}


def dispatch_get_read_route(handler, parsed, ctx) -> bool:
    route = _GET_ROUTES.get(parsed.path)
    if route is None:
        return False
    route(handler, parsed, ctx)
    return True
