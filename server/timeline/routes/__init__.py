from __future__ import annotations

from fs.log.meta import log_workspace_claims
from fs.log.paths import workspace_timeline_path
from server.timeline.routes.assets import dispatch_get_assets_route
from server.timeline.routes.read import JSON_GET_PATHS, dispatch_get_read_route
from server.timeline.routes.write import dispatch_post_write_route


def _send_not_found(handler, method: str, path: str, error: str) -> None:
    if method == "POST" or path in JSON_GET_PATHS:
        handler._send_json(404, {"ok": False, "error": error})
    else:
        handler.send_error(404)


def dispatch_timeline_route(handler, method: str, parsed, hub) -> bool:
    parts = parsed.path.split("/", 3)
    if len(parts) < 3 or parts[1] != "timeline":
        return False
    prefix = f"/timeline/{parts[2]}"
    workspace = next((workspace for _name, workspace in log_workspace_claims().values()
                      if workspace_timeline_path(workspace) == prefix), None)
    if workspace is None:
        _send_not_found(handler, method, f"/{parts[3]}" if len(parts) == 4 else "/", "Timeline not found")
        return True
    if len(parts) == 3:
        handler._redirect(prefix + "/" + ("?" + parsed.query if parsed.query else ""))
        return True
    handler.timeline_base_path = prefix
    parsed = parsed._replace(path=f"/{parts[3]}" if len(parts) == 4 else "/")
    routes = (dispatch_get_assets_route, dispatch_get_read_route) if method == "GET" else (dispatch_post_write_route,)
    with hub.timeline_request(workspace, watch=method == "GET" and parsed.path == "/events") as state:
        ctx = {
            "state": state,
            "files": state.files,
            "assets": hub.assets,
            "send_message_fn": state.send_message,
        }
        for dispatch in routes:
            if dispatch(handler, parsed, ctx):
                return True
        _send_not_found(handler, method, parsed.path, "Not found")
        return True
