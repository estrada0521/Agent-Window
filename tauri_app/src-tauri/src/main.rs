use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
use std::collections::HashMap;
use std::path::Path;
use std::process::{Child, Command};
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, NativeIcon, SubmenuBuilder};
use tauri::webview::WebviewWindowBuilder;
use tauri::Manager;

const DARK_BG: &str = "rgb(4,4,4)";

#[cfg(target_os = "macos")]
use window_vibrancy::{
    apply_liquid_glass, apply_vibrancy, NSGlassEffectViewStyle, NSVisualEffectMaterial,
    NSVisualEffectState,
};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatHeaderMenuPayload {
    x: f64,
    y: f64,
    session_active: bool,
    add_agents: Vec<String>,
    remove_agents: Vec<String>,
    #[serde(default)]
    agent_icons: HashMap<String, Vec<u8>>,
}

fn agent_base_name(name: &str) -> String {
    let lower = name.to_lowercase();
    if let Some(pos) = lower.rfind('-') {
        let suffix = &lower[pos + 1..];
        if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
            return lower[..pos].to_string();
        }
    }
    lower
}

#[derive(Debug, serde::Serialize)]
struct NativeMenuActionPayload {
    action: String,
    mode: Option<String>,
    agent: Option<String>,
}

const INJECT_JS: &str = include_str!("inject.js");
const NATIVE_MENU_PREFIX: &str = "agent-window-chat:";

fn encode_menu_component(value: &str) -> String {
    let mut out = String::new();
    for byte in value.as_bytes() {
        let ch = *byte as char;
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            out.push(ch);
        } else {
            out.push('~');
            out.push_str(&format!("{:02X}", byte));
        }
    }
    out
}

fn decode_menu_component(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'~' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(decoded) = u8::from_str_radix(hex, 16) {
                    out.push(decoded);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[tauri::command]
fn show_chat_header_menu(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    payload: ChatHeaderMenuPayload,
) -> Result<(), String> {
    let add_enabled = payload.session_active && !payload.add_agents.is_empty();
    let remove_enabled = payload.session_active && payload.remove_agents.len() > 1;

    let mut add_builder = SubmenuBuilder::with_id(
        &app,
        format!("{}submenu:addAgent", NATIVE_MENU_PREFIX),
        "Add Agent",
    )
    .submenu_native_icon(NativeIcon::Add)
    .enabled(add_enabled);
    for agent in &payload.add_agents {
        let id = format!("{}add:{}", NATIVE_MENU_PREFIX, encode_menu_component(agent));
        let base = agent_base_name(agent);
        if let Some(rgba) = payload.agent_icons.get(&base) {
            if rgba.len() == 22 * 22 * 4 {
                let img = tauri::image::Image::new_owned(rgba.clone(), 22, 22);
                add_builder = add_builder.icon(id, agent.as_str(), img);
                continue;
            }
        }
        add_builder = add_builder.native_icon(id, agent.as_str(), NativeIcon::User);
    }
    let add_submenu = add_builder.build().map_err(|err| err.to_string())?;

    let mut remove_builder = SubmenuBuilder::with_id(
        &app,
        format!("{}submenu:removeAgent", NATIVE_MENU_PREFIX),
        "Remove Agent",
    )
    .submenu_native_icon(NativeIcon::Remove)
    .enabled(remove_enabled);
    for agent in &payload.remove_agents {
        let id = format!(
            "{}remove:{}",
            NATIVE_MENU_PREFIX,
            encode_menu_component(agent)
        );
        let base = agent_base_name(agent);
        if let Some(rgba) = payload.agent_icons.get(&base) {
            if rgba.len() == 22 * 22 * 4 {
                let img = tauri::image::Image::new_owned(rgba.clone(), 22, 22);
                remove_builder = remove_builder.icon(id, agent.as_str(), img);
                continue;
            }
        }
        remove_builder = remove_builder.native_icon(id, agent.as_str(), NativeIcon::User);
    }
    let remove_submenu = remove_builder.build().map_err(|err| err.to_string())?;

    let menu = MenuBuilder::new(&app)
        .native_icon(
            format!("{}action:openTerminal", NATIVE_MENU_PREFIX),
            "Terminal",
            NativeIcon::Computer,
        )
        .native_icon(
            format!("{}action:openFinder", NATIVE_MENU_PREFIX),
            "Finder",
            NativeIcon::Folder,
        )
        .separator()
        .item(&add_submenu)
        .item(&remove_submenu)
        .build()
        .map_err(|err| err.to_string())?;

    window
        .popup_menu_at(&menu, tauri::LogicalPosition::new(payload.x, payload.y))
        .map_err(|err| err.to_string())
}

fn emit_native_menu_action(app: &tauri::AppHandle, id: &str) {
    if !id.starts_with(NATIVE_MENU_PREFIX) {
        return;
    }
    let rest = &id[NATIVE_MENU_PREFIX.len()..];
    let payload = if let Some(action) = rest.strip_prefix("action:") {
        NativeMenuActionPayload {
            action: action.to_string(),
            mode: None,
            agent: None,
        }
    } else if let Some(agent) = rest.strip_prefix("add:") {
        NativeMenuActionPayload {
            action: "agent".to_string(),
            mode: Some("add".to_string()),
            agent: Some(decode_menu_component(agent)),
        }
    } else if let Some(agent) = rest.strip_prefix("remove:") {
        NativeMenuActionPayload {
            action: "agent".to_string(),
            mode: Some("remove".to_string()),
            agent: Some(decode_menu_component(agent)),
        }
    } else {
        return;
    };

    let Ok(json) = serde_json::to_string(&payload) else {
        return;
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(&format!(
            "window.dispatchEvent(new CustomEvent('native-menu-action', {{ detail: {} }}));",
            json
        ));
    }
}

// CARGO_MANIFEST_DIR is set automatically by Cargo for every build, no script
// or shell needs to export anything. It points at tauri_app/src-tauri; the
// repo root is two directories up. The installed .app is a standalone copy
// launched from the Dock/Finder, with no reliable runtime signal for where
// its source repo lives, so the path is fixed at compile time instead of
// guessed at launch time.
const CARGO_MANIFEST_DIR: &str = env!("CARGO_MANIFEST_DIR");

fn find_repo_root() -> Option<String> {
    let repo_root = Path::new(CARGO_MANIFEST_DIR).parent()?.parent()?;
    if repo_root.join("bin/agent-index").exists() {
        Some(repo_root.to_string_lossy().to_string())
    } else {
        None
    }
}

fn show_hub_error(window: &tauri::WebviewWindow, message: &str) {
    let escaped = message.replace('\\', "\\\\").replace('\'', "\\'");
    let _ = window.eval(&format!(
        "document.body.style.cssText='background:{};color:#fff;padding:60px 40px;font:18px -apple-system,sans-serif';document.body.textContent='{}';",
        DARK_BG, escaped
    ));
    let _ = window.show();
}

fn configured_hub_port() -> u16 {
    std::env::var("AGENT_INDEX_HUB_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(8788)
}

fn hub_ready(port: u16, use_https: bool) -> bool {
    let scheme = if use_https { "https" } else { "http" };
    let url = format!("{}://127.0.0.1:{}/hub.webmanifest", scheme, port);
    let mut args = vec!["-s", "--max-time", "1", url.as_str()];
    if use_https {
        args.insert(0, "-k");
    }
    let Ok(output) = Command::new("/usr/bin/curl").args(&args).output() else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let body = String::from_utf8_lossy(&output.stdout);
    body.contains("\"name\"") && body.contains("Agent Window")
}

fn wait_for_child_success(child: &mut Child, timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    return false;
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return false,
        }
    }
}

fn apply_app_vibrancy(window: &tauri::WebviewWindow) {
    if let Err(err) = apply_liquid_glass(window, NSGlassEffectViewStyle::Clear, None, Some(26.0)) {
        eprintln!("[app] liquid glass apply failed: {}", err);
        if let Err(err) = apply_vibrancy(
            window,
            NSVisualEffectMaterial::HudWindow,
            Some(NSVisualEffectState::Active),
            Some(18.0),
        ) {
            eprintln!("[app] vibrancy apply failed: {}", err);
        }
    }
}

fn center_traffic_lights(window: &tauri::WebviewWindow) {
    unsafe {
        let ns_window = match window.ns_window() {
            Ok(handle) => handle as *const objc2::runtime::AnyObject,
            Err(err) => {
                eprintln!("[app] traffic lights unavailable: {}", err);
                return;
            }
        };
        let ns_window_obj: &NSWindow = &*(ns_window as *const _);
        let Some(close) = ns_window_obj.standardWindowButton(NSWindowButton::CloseButton) else {
            return;
        };
        let Some(miniaturize) =
            ns_window_obj.standardWindowButton(NSWindowButton::MiniaturizeButton)
        else {
            return;
        };
        let zoom = ns_window_obj.standardWindowButton(NSWindowButton::ZoomButton);

        let Some(title_bar_view) = close.superview().and_then(|view| view.superview()) else {
            return;
        };

        let close_rect = NSView::frame(&close);
        let spacing = NSView::frame(&miniaturize).origin.x - close_rect.origin.x;
        let button_count = if zoom.is_some() { 3.0 } else { 2.0 };
        let cluster_width = close_rect.size.width + (spacing * (button_count - 1.0));
        let target_x = ((ns_window_obj.frame().size.width - cluster_width) / 2.0).round();
        let title_bar_height = 26.0;

        let mut title_bar_rect = NSView::frame(&title_bar_view);
        title_bar_rect.size.height = title_bar_height;
        title_bar_rect.origin.y = ns_window_obj.frame().size.height - title_bar_height;
        title_bar_view.setFrame(title_bar_rect);

        let mut buttons = vec![close, miniaturize];
        if let Some(zoom) = zoom {
            buttons.push(zoom);
        }
        for (index, button) in buttons.into_iter().enumerate() {
            let mut rect = NSView::frame(&button);
            rect.origin.x = target_x + (index as f64 * spacing);
            rect.origin.y = ((title_bar_height - rect.size.height) / 2.0).round();
            button.setFrameOrigin(rect.origin);
        }
    }
}

fn reveal_main_window(app: &tauri::AppHandle) {
    let _ = app.show();
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if matches!(window.is_minimized(), Ok(true)) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    let _ = window.set_focus();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![show_chat_header_menu])
        .on_menu_event(|app, event| {
            emit_native_menu_action(app, event.id().as_ref());
        })
        .setup(move |app| {
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Agent Window")
            .inner_size(1000.0, 1000.0)
            .min_inner_size(400.0, 500.0)
            .decorations(true)
            .hidden_title(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .transparent(true)
            .visible(false)
            .devtools(true)
            .initialization_script(INJECT_JS)
            .initialization_script_for_all_frames(INJECT_JS)
            .disable_drag_drop_handler()
            .build()?;

            apply_app_vibrancy(&window);
            center_traffic_lights(&window);
            let traffic_window = window.clone();
            window.on_window_event(move |event| {
                if matches!(
                    event,
                    tauri::WindowEvent::Resized(_)
                        | tauri::WindowEvent::Moved(_)
                        | tauri::WindowEvent::Focused(_)
                        | tauri::WindowEvent::ScaleFactorChanged { .. }
                ) {
                    center_traffic_lights(&traffic_window);
                } else if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = traffic_window.hide();
                    let _ = traffic_window.app_handle().hide();
                }
            });

            let repo_root = find_repo_root().unwrap_or_default();
            if repo_root.is_empty() {
                show_hub_error(&window, "Could not find the Agent Window repo.");
                return Ok(());
            }
            eprintln!("[app] repo = {}", repo_root);

            let hub_port = configured_hub_port();
            let home = std::env::var("HOME").unwrap_or_default();
            let path = format!(
                "/opt/homebrew/bin:/opt/homebrew/sbin:{}/.cargo/bin:{}/.nvm/versions/node/v24.14.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
                home, home,
            );
            let cert_dir = std::env::var("AGENT_WINDOW_CERTS_DIR")
                .unwrap_or_else(|_| format!("{}/.agent-window/state/certs", home));
            let cert_file = format!("{}/cert.pem", cert_dir);
            let key_file = format!("{}/key.pem", cert_dir);
            let has_certs = Path::new(&cert_file).exists() && Path::new(&key_file).exists();
            let state_dir = std::env::var("AGENT_WINDOW_STATE_DIR")
                .unwrap_or_else(|_| format!("{}/.agent-window/state", home));
            let pwa_enabled_file = format!("{}/pwa/enabled", state_dir);
            let use_https = Path::new(&pwa_enabled_file).exists();
            if std::env::var("AGENT_WINDOW_TAURI_USE_HTTPS").ok().as_deref() == Some("1")
                && !use_https
            {
                show_hub_error(
                    &window,
                    "PWA HTTPS is not enabled. Start the HTTP app first, then run ./setup/pwa/enable.",
                );
                return Ok(());
            }
            if use_https && !has_certs {
                show_hub_error(
                    &window,
                    "Local HTTPS certificates are missing. Start the HTTP app first, then run ./setup/pwa/enable.",
                );
                return Ok(());
            }

            let hub_already_up = hub_ready(hub_port, use_https);
            let mut spawned_hub: Option<Child> = None;
            if !hub_already_up {
                let mut cmd = Command::new(format!("{}/bin/agent-index", repo_root));
                cmd.args([
                    "--hub",
                    "--hub-port",
                    &hub_port.to_string(),
                    if use_https { "--https" } else { "--http" },
                ])
                    .current_dir(&repo_root)
                    .env("PATH", &path)
                    .env("AGENT_INDEX_HUB_PORT", hub_port.to_string())
                    .env("PYTHONPATH", repo_root.clone());
                if use_https {
                    cmd.env("AGENT_WINDOW_CERT_FILE", &cert_file)
                        .env("AGENT_WINDOW_KEY_FILE", &key_file);
                }
                match cmd.spawn() {
                    Ok(c) => {
                        eprintln!("[app] Hub spawned pid={}", c.id());
                        spawned_hub = Some(c);
                    }
                    Err(e) => {
                        eprintln!("[app] Hub spawn failed: {}", e);
                        show_hub_error(&window, &format!("Failed to start Hub: {}", e));
                        return Ok(());
                    }
                }
            } else {
                eprintln!("[app] Hub already up");
            }

            let app_handle = app.handle().clone();
            thread::spawn(move || {
                let show_error = |message: String| {
                    if let Some(w) = app_handle.get_webview_window("main") {
                        show_hub_error(&w, &message);
                    }
                };
                if let Some(mut child) = spawned_hub {
                    if !wait_for_child_success(&mut child, Duration::from_secs(8)) {
                        eprintln!("[app] Hub failed to start");
                        show_error(format!("Hub failed to start on port {}", hub_port));
                        return;
                    }
                }
                let scheme = if use_https { "https" } else { "http" };
                let hub_url = format!("{}://127.0.0.1:{}/?tauri=1", scheme, hub_port);
                eprintln!("[app] Navigating to {}", hub_url);
                if let Some(w) = app_handle.get_webview_window("main") {
                    let url: tauri::Url = hub_url.parse().unwrap();
                    let _ = w.navigate(url);
                    let _ = w.show();
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Agent Window")
        .run(|app, event| {
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                reveal_main_window(app);
            }
        });
}
