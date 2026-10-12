from __future__ import annotations

from fs.log.meta import log_workspace_claims
from fs.log.paths import workspace_timeline_path
from server.timeline.routes.assets import dispatch_get_assets_route
from server.timeline.routes.read import dispatch_get_read_route
from server.timeline.routes.write import dispatch_post_write_route


def dispatch_timeline_route(handler, method: str, parsed, hub) -> bool:
    parts = parsed.path.split("/", 3)
    if len(parts) < 3 or parts[1] != "timeline":
        return False
    prefix = f"/timeline/{parts[2]}"
    workspace = next((workspace for _name, workspace in log_workspace_claims().values()
                      if workspace_timeline_path(workspace) == prefix), None)
    if workspace is None:
        handler.send_error(404)
        return True
    if len(parts) == 3:
        handler._redirect(prefix + "/" + ("?" + parsed.query if parsed.query else ""))
        return True
    state = hub.timeline(workspace)
    ctx = {
        "state": state,
        "files": state.files,
        "assets": hub.assets,
        "hub": hub,
        "send_message_fn": state.send_message,
    }
    handler.timeline_base_path = prefix
    parsed = parsed._replace(path=f"/{parts[3]}" if len(parts) == 4 else "/")
    routes = (dispatch_get_assets_route, dispatch_get_read_route) if method == "GET" else (dispatch_post_write_route,)
    for dispatch in routes:
        if dispatch(handler, parsed, ctx):
            return True
    handler.send_error(404)
    return True
